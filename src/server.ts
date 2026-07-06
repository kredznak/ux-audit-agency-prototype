/**
 * Local server for the UX Audit UI.
 *
 * Serves index.html and exposes POST /api/audit, which runs the real Claude
 * Agent SDK pipeline (page-inspector → lens subagents → synthesizer) and
 * streams progress + structured findings back over SSE. The API key / Claude
 * Code login stays on this process — it is never shipped to the browser.
 *
 *   npm run serve            # http://localhost:4000
 *   AUDIT_PORT=8080 npm run serve
 */
import { createServer, type IncomingMessage } from "node:http";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { query } from "@anthropic-ai/claude-agent-sdk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AUDIT_PORT ?? 4000);

type SseEvent = { type: string; [k: string]: unknown };

/** Pull the last ```json fenced block (or a bare object) out of the model's final text. */
function extractJson(text: string): any {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidate = fences.length
    ? fences[fences.length - 1][1]
    : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate.trim());
}

const SEVERITIES = new Set(["critical", "major", "minor"]);

/**
 * Normalize whatever the pipeline returns into the browser's card shape.
 * Tolerant of both the synthesizer contract (`findings` / category / description
 * / fix / source) and the reasoning contract (`roadmap` / reference / evidence
 * / recommendation / provenance) — the Lead relays either.
 */
function normalize(payload: any): {
  summary: string;
  counts: { critical: number; major: number; minor: number };
  findings: any[];
} {
  const raw = Array.isArray(payload?.findings)
    ? payload.findings
    : Array.isArray(payload?.roadmap)
      ? payload.roadmap
      : [];

  const findings = raw.map((f: any) => {
    const sev = String(f.severity ?? "").toLowerCase();
    const ref = f.category ?? f.reference ?? "";
    return {
      severity: SEVERITIES.has(sev) ? sev : "minor",
      agent: Array.isArray(f.agent) ? f.agent.join(" + ") : (f.agent ?? "audit"),
      category: String(ref).split(";")[0].trim(),
      title: f.title ?? "",
      description: f.description ?? f.evidence ?? "",
      location: f.location ?? "",
      fix: f.fix ?? f.recommendation ?? "",
      source: String(f.source ?? f.provenance ?? "real").toLowerCase(),
    };
  });

  const counts = { critical: 0, major: 0, minor: 0 };
  for (const f of findings) counts[f.severity as keyof typeof counts]++;

  return { summary: payload?.summary ?? "", counts, findings };
}

const FINAL_JSON =
  `Your final message MUST be the synthesizer's JSON object verbatim, inside a ` +
  `single \`\`\`json code block — do not reformat, summarize, or add prose around it.`;

function urlPrompt(url: string): string {
  return (
    `Run a UX audit of: ${url}\n\n` +
    `Follow the orchestration intent in CLAUDE.md exactly: inspect the page with ` +
    `the page-inspector skill (Playwright MCP), route the reasoning subagents per ` +
    `the routing table, and run the synthesizer LAST.\n\n` + FINAL_JSON
  );
}

function screenshotPrompt(path: string): string {
  return (
    `Run a UX audit of this screenshot image file: ${path}\n\n` +
    `Follow the orchestration intent in CLAUDE.md exactly. There is NO live URL — ` +
    `do not use Playwright. Use the page-inspector skill to build a snapshot from ` +
    `the image (source: "screenshot"); Read the image file for pixel-level detail. ` +
    `Route the reasoning subagents per the routing table — a screenshot IS ` +
    `available, so include visual-hierarchy, and include mobile-responsive if it ` +
    `looks like a mobile / narrow viewport. Run the synthesizer LAST.\n\n` + FINAL_JSON
  );
}

// ── Public-demo guardrails ─────────────────────────────────────────────────
// This endpoint drives a real browser and spends real money per call, so on a
// public URL these are load-bearing, not optional.
const MAX_BODY_BYTES = 6 * 1024 * 1024; // cap screenshot uploads
const RATE_WINDOW_MS = 15 * 60_000; // per-IP window
const RATE_PER_IP = Number(process.env.AUDIT_RATE_PER_IP ?? 3);
const MAX_CONCURRENT = Number(process.env.AUDIT_MAX_CONCURRENT ?? 1);
const DAILY_CAP = Number(process.env.AUDIT_DAILY_CAP ?? 40); // hard spend ceiling
const AUDIT_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS ?? 8 * 60_000);

const ipHits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_PER_IP) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  return false;
}

let active = 0; // in-flight audits (concurrency guard)
let dayKey = ""; // resets the daily counter at UTC midnight
let dayCount = 0;
function overDailyCap(): boolean {
  const k = new Date().toISOString().slice(0, 10);
  if (k !== dayKey) {
    dayKey = k;
    dayCount = 0;
  }
  return dayCount >= DAILY_CAP;
}

function clientIp(req: IncomingMessage): string {
  const fly = req.headers["fly-client-ip"];
  if (typeof fly === "string" && fly) return fly;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

/** SSRF guard: private / loopback / link-local / metadata / CGNAT ranges. */
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local + cloud metadata (169.254.169.254)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    );
  }
  const s = ip.toLowerCase();
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return isPrivateIp(m[1]);
  return s === "::1" || s === "::" || s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd");
}

/** Only allow public http/https URLs — resolve DNS and reject internal targets. */
async function assertPublicUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http/https URLs are allowed");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal"))
    throw new Error("private host blocked");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length) throw new Error("host did not resolve");
  for (const a of addrs) if (isPrivateIp(a)) throw new Error("URL resolves to a private address");
}

async function runAudit(prompt: string, send: (e: SseEvent) => void, ac: AbortController): Promise<void> {
  const seen = new Set<string>();

  const run = query({
    prompt,
    options: {
      abortController: ac,
      settingSources: ["project"],
      skills: ["page-inspector"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(process.env.AUDIT_MODEL ? { model: process.env.AUDIT_MODEL } : {}),
    },
  });

  for await (const msg of run) {
    if (process.env.AUDIT_DEBUG) {
      const tag = msg.type === "assistant" ? `assistant sub=${(msg as any).subagent_type ?? "-"}` : msg.type;
      process.stderr.write(`[dbg] ${tag}\n`);
      if (msg.type === "result" && (msg as any).subtype === "success") {
        (await import("node:fs")).writeFileSync("/tmp/audit-raw.txt", (msg as any).result);
      }
    }
    if (msg.type === "assistant") {
      // The Lead dispatches each lens via a `Task` tool call — the reliable
      // signal for which agents ran (subagent_type on the message is spotty).
      const emit = (name: unknown) => {
        const agent = String(name ?? "").trim();
        if (agent && !seen.has(agent)) {
          seen.add(agent);
          send({ type: "agent", agent });
        }
      };
      if (msg.subagent_type) emit(msg.subagent_type);
      for (const block of msg.message.content) {
        if (block.type === "tool_use" && block.name === "Task") {
          emit((block.input as any)?.subagent_type);
        }
      }
    } else if (msg.type === "result") {
      if (msg.subtype === "success") {
        let payload: any;
        try {
          payload = extractJson(msg.result);
        } catch (err) {
          send({ type: "error", message: `Could not parse audit JSON: ${String(err)}` });
          return;
        }
        send({ type: "findings", ...normalize(payload) });
        send({
          type: "done",
          turns: msg.num_turns,
          seconds: +(msg.duration_ms / 1000).toFixed(1),
          cost: +msg.total_cost_usd.toFixed(4),
        });
      } else {
        send({ type: "error", message: `Audit failed: ${msg.subtype}` });
      }
    }
  }
}

const server = createServer(async (req, res) => {
  // Serve the UI.
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    try {
      const html = await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500).end("index.html not found");
    }
    return;
  }

  // Run an audit, streaming events as Server-Sent Events.
  if (req.method === "POST" && req.url === "/api/audit") {
    // Read the body with a hard size cap.
    let body = "";
    let tooBig = false;
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY_BYTES) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (tooBig) {
        res.writeHead(413).end("payload too large");
        return;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end("bad JSON");
        return;
      }
      const url = String(parsed.url ?? "").trim();
      const image = typeof parsed.image === "string" ? parsed.image : "";
      if (!url && !image) {
        res.writeHead(400).end("missing url or image");
        return;
      }

      // Guardrails — return real HTTP codes before switching to SSE.
      const ip = clientIp(req);
      if (rateLimited(ip)) {
        res.writeHead(429).end("rate limit — try again later");
        return;
      }
      if (active >= MAX_CONCURRENT) {
        res.writeHead(429).end("busy — an audit is already running");
        return;
      }
      if (overDailyCap()) {
        res.writeHead(503).end("daily demo limit reached — try again tomorrow");
        return;
      }
      if (url) {
        try {
          await assertPublicUrl(url);
        } catch (e) {
          res.writeHead(400).end(`blocked: ${(e as Error).message}`);
          return;
        }
      }

      // Commit: count this audit against the daily cap and switch to SSE.
      dayCount++;
      active++;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const send = (e: SseEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

      // SSE keepalive: audits have long quiet stretches (page inspection, a slow
      // subagent) with no events. A comment line every 15s keeps the connection
      // active so the Fly proxy doesn't treat it as idle and drop it.
      const heartbeat = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {}
      }, 15_000);

      // Hard timeout that actually aborts the SDK run (bounds spend).
      const ac = new AbortController();
      const timeout = setTimeout(() => {
        send({ type: "error", message: `audit exceeded ${Math.round(AUDIT_TIMEOUT_MS / 1000)}s — aborted` });
        ac.abort();
      }, AUDIT_TIMEOUT_MS);

      let shotPath: string | null = null;
      try {
        let prompt: string;
        if (image) {
          // Decode the uploaded screenshot to a temp file the SDK's Read tool
          // (and the visual lenses) can open. Path in, no image blocks needed.
          const ext = /jpe?g/.test(String(parsed.mediaType ?? "")) ? "jpg" : "png";
          const dir = join(ROOT, ".audit-tmp");
          await mkdir(dir, { recursive: true });
          shotPath = join(dir, `shot-${Date.now()}.${ext}`);
          await writeFile(shotPath, Buffer.from(image, "base64"));
          prompt = screenshotPrompt(shotPath);
        } else {
          prompt = urlPrompt(url);
        }
        await runAudit(prompt, send, ac);
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        active--;
        if (shotPath) {
          try {
            await unlink(shotPath);
          } catch {}
        }
        res.end();
      }
    });
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, () => {
  console.log(`\n  UX Audit server → http://localhost:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  (no ANTHROPIC_API_KEY — using the Claude Code login if available)\n");
  }
});

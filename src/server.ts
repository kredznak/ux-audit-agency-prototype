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
import { createServer } from "node:http";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

async function runAudit(prompt: string, send: (e: SseEvent) => void): Promise<void> {
  const seen = new Set<string>();

  const run = query({
    prompt,
    options: {
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
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
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

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const send = (e: SseEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

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
        await runAudit(prompt, send);
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
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

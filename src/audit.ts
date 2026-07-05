/**
 * UX Audit runner — drives the Claude Agent SDK over the project's own
 * `.claude/` definitions.
 *
 * The SDK loads this repo's Lead context (CLAUDE.md), the seven lens subagents
 * plus the synthesizer (`.claude/agents/*.md`), the page-inspector skill
 * (`.claude/skills/`), and the Playwright MCP server (`.mcp.json`) — all via
 * `settingSources: ['project']`. We don't re-declare any prompts here; the
 * committed definitions ARE the SDK's input.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npm run audit -- https://example.com
 *   ANTHROPIC_API_KEY=sk-ant-... npm run audit -- ./screenshot.png
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const target = process.argv[2];

if (!target) {
  console.error("Usage: npm run audit -- <url | screenshot-path>");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  // Not fatal: the Agent SDK also resolves auth from an existing Claude Code
  // login (the `claude` CLI). Set ANTHROPIC_API_KEY to force a specific key.
  console.error(
    "Note: ANTHROPIC_API_KEY not set — using the Claude Code login if available.",
  );
}

// The Lead's instructions live in CLAUDE.md; this prompt just hands it the target.
const prompt =
  `Run a UX audit of: ${target}\n\n` +
  `Follow the orchestration intent in CLAUDE.md exactly:\n` +
  `1. Inspect the page with the page-inspector skill (Playwright MCP for a URL, ` +
  `or build a snapshot from the screenshot if given a file).\n` +
  `2. Route the reasoning subagents per the routing table, passing each the snapshot.\n` +
  `3. Run the synthesizer LAST to dedupe, resolve, and rank by severity.\n` +
  `4. Return the prioritized roadmap.`;

console.error(`\n▶ Auditing ${target}\n`);

const run = query({
  prompt,
  options: {
    // Load CLAUDE.md, .claude/agents/*, and .mcp.json from this project.
    settingSources: ["project"],
    // Turn on the capability layer.
    skills: ["page-inspector"],
    // Non-interactive: let the agent drive the browser without approval prompts.
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // Let the caller pin the Lead's model; otherwise inherit the SDK default.
    ...(process.env.AUDIT_MODEL ? { model: process.env.AUDIT_MODEL } : {}),
  },
});

for await (const msg of run) {
  if (msg.type === "assistant") {
    // Label output by which lens produced it (the synthesizer, a subagent, or the Lead).
    const who = msg.subagent_type ?? "lead";
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`\n[${who}] ${block.text.trim()}`);
      } else if (block.type === "tool_use") {
        console.error(`  · ${who} → ${block.name}`);
      }
    }
  } else if (msg.type === "result") {
    if (msg.subtype === "success") {
      console.log("\n" + "─".repeat(60));
      console.log(msg.result);
      console.log("─".repeat(60));
      console.error(
        `\n✓ ${msg.num_turns} turns · ${(msg.duration_ms / 1000).toFixed(1)}s · ` +
          `$${msg.total_cost_usd.toFixed(4)}`,
      );
    } else {
      console.error(`\n✗ Audit failed: ${msg.subtype}`);
      process.exit(1);
    }
  }
}

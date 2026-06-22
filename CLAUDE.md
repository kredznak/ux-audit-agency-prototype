# UX Audit Agency

A single-file HTML prototype that uses Claude as a UX audit orchestrator. Open `index.html` in Chrome — no setup, no build step.

**GitHub:** https://github.com/kredznak/ux-audit-agency-prototype

## How it works

User pastes a URL or uploads a screenshot → real Claude API call classifies the page → agents animate in on the left → each spawned agent makes its own real Claude call and findings appear on the right sorted by severity (critical → major → minor).

**Agents (7):** heuristics (always), accessibility (always), visual/hierarchy (screenshot only), forms/flow (checkout/form pages), copy (landing/content pages), conversion/CTA (landing/checkout pages), mobile/responsive (mobile screenshot only). The orchestrator picks which to spawn; they run in parallel. Falls back to heuristics-only if classification fails.

## Key technical details

- Single file: all HTML, CSS, and JS in `index.html`
- Model: `claude-haiku-4-5-20251001`
- Requires `anthropic-dangerous-direct-browser-access: true` header for browser-direct API calls
- Each spawned agent makes a real Claude call. Findings are labeled by provenance: **REAL** (screenshot, analyzed directly), **INFERRED** (URL, reasoned from the URL without seeing the live page), or **FALLBACK** (pre-written mock data, used when an agent's call fails). A banner appears when any agent falls back.
- The mock `FINDINGS` database is the per-agent fallback library, not the primary source
- Three `<script>` blocks in order: orchestrator → findings database → drop zone

## Orchestration intent (agent architecture)

The audit runs as a **3-layer pipeline**. It exists in two parallel forms: the runtime prototype in `index.html` (browser-direct Claude calls) and the Claude Code agent definitions under `.claude/` that this section governs.

1. **Context layer** — this file (`CLAUDE.md`). Loaded every session; governs every agent and skill below. Product decisions live in `docs/prd.md`.
2. **Reasoning layer** — sub-agents in `.claude/agents/`: seven lenses — `heuristics` (Nielsen's 10), `accessibility` (WCAG 2.2, focus order), `visual-hierarchy` (layout, typography, scan path), `forms-flow` (friction points), `copy` (clarity, microcopy), `conversion-cta` (CTAs, persuasion, trust), `mobile-responsive` (touch targets, reflow) — plus `synthesizer` (dedupe, resolve, rank — last step).
3. **Capability layer** — skills in `.claude/skills/`: `page-inspector`, which drives the **Playwright MCP** (`.mcp.json`) to inspect a real page and return a structured snapshot.

### The Lead (orchestrator — this main session)

You are the **Lead**: the main agent talker. On an audit request:

1. **Read** this file (and `docs/prd.md` for product context).
2. **Inspect the page** — invoke the `page-inspector` skill, which drives the Playwright MCP against the URL (or builds a snapshot from an uploaded screenshot) and returns one structured snapshot.
3. **Route conditionally** — see the routing table. Always run `heuristics` and `accessibility`; add `forms-flow` only when the snapshot contains a form / checkout / multi-step flow.
4. **Run the routed sub-agents in parallel**, passing each the structured snapshot. The `page-inspector` skill feeds structured data back to any sub-agent that needs a closer look.
5. **Run `synthesizer` last** — it dedupes, resolves conflicts, and ranks by severity.
6. **Return the prioritized roadmap** the synthesizer produces.

If page inspection fails (no Playwright, dead URL), fall back to `heuristics` + `accessibility` only and label findings `INFERRED`.

### Routing table

| Condition | Sub-agents dispatched |
| --- | --- |
| Always | `heuristics`, `accessibility` |
| Screenshot available | + `visual-hierarchy` |
| Form / checkout / multi-step flow detected | + `forms-flow` |
| Landing / content-heavy page | + `copy` |
| Landing / checkout page | + `conversion-cta` |
| Mobile screenshot or mobile review requested | + `mobile-responsive` |
| Always, last | `synthesizer` |

This is the same routing the prototype performs in `index.html` ("Agents (7)" above) — now mirrored as Claude Code sub-agents.

### Finding contract

Every reasoning sub-agent returns a JSON array of findings in this exact shape; the synthesizer consumes them:

```json
{
  "id": "heur-1",
  "agent": "heuristics | accessibility | visual-hierarchy | forms-flow | copy | conversion-cta | mobile-responsive",
  "title": "short problem statement",
  "severity": "critical | major | minor",
  "reference": "Nielsen #4 — Consistency / WCAG 2.2 1.4.3 — Contrast / friction:validation-on-submit",
  "location": "selector, region, or screenshot area",
  "evidence": "what in the snapshot shows this",
  "recommendation": "specific, actionable fix",
  "provenance": "REAL | INFERRED"
}
```

Severity: **critical** = blocks the task or risks data loss; **major** = significant friction; **minor** = polish.

## How Claude should respond

- Keep everything in `index.html` — no splitting into multiple files
- Preserve the minimal/editorial style: no color fills, high contrast, typography-first
- Be concise; ask if anything is unclear

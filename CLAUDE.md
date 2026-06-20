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

## How Claude should respond

- Keep everything in `index.html` — no splitting into multiple files
- Preserve the minimal/editorial style: no color fills, high contrast, typography-first
- Be concise; ask if anything is unclear

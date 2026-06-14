# UX Audit Agency

A single-file HTML prototype that uses Claude as a UX audit orchestrator. Open `index.html` in Chrome — no setup, no build step.

**GitHub:** https://github.com/kredznak/ux-audit-agency-prototype

## How it works

User pastes a URL or uploads a screenshot → real Claude API call classifies the page → agents animate in on the left → mock findings appear on the right sorted by severity (critical → major → minor).

**Agents:** heuristics (always), accessibility (URL), forms (checkout/form pages), copy (landing pages only). Falls back to heuristics-only if the API call fails.

## Key technical details

- Single file: all HTML, CSS, and JS in `index.html`
- Model: `claude-haiku-4-5-20251001`
- Requires `anthropic-dangerous-direct-browser-access: true` header for browser-direct API calls
- Findings are pre-written mock data, not real analysis
- Three `<script>` blocks in order: orchestrator → findings database → drop zone

## How Claude should respond

- Keep everything in `index.html` — no splitting into multiple files
- Preserve the minimal/editorial style: no color fills, high contrast, typography-first
- Be concise; ask if anything is unclear

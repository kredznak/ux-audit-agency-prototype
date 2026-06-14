# Design Spec: UX Audit Agency Prototype

**Date:** 2026-06-09
**Status:** Approved
**Demo location:** `demos/ux-audit-agency/index.html`

---

## What we're building

A single-file HTML prototype of the UX Audit Agency's core feature: an orchestrator that accepts a URL or screenshots, makes a real Claude API call to classify the page and decide which agents to spawn, then displays mock-but-realistic agent findings in a prioritized report.

This is a course demo for non-technical PMs. Zero setup — open the file, add an API key, paste a URL, watch it work.

---

## Decisions made

| Decision | Choice | Reason |
|---|---|---|
| Delivery format | Single HTML file | Zero setup; easy to share and demo in class |
| API calls | Hybrid — real orchestrator call, mock findings | Proves the agentic routing with a live Claude call; mock findings keep demo fast and reliable |
| Layout | Split panel | Input + routing status left; findings right |
| Visual style | Minimal/Editorial | High-contrast, no color fills, typography-first; approachable for PM audience |
| Reveal pattern | Sequential | Routing decision animates in step by step, then findings stagger in; maximizes demo legibility |

---

## Architecture

### Single file structure

One self-contained `index.html` with inline CSS and vanilla JS. No build step, no `npm install`, no server.

```
demos/ux-audit-agency/
└── index.html
```

### Data flow

```
User enters URL or uploads screenshot
  → clicks "Run audit"
  → Left panel: "Analyzing page..." state
  → Real Claude API call (orchestrator classification)
  → Claude returns JSON: { page_type, agents_to_spawn, reasoning }
  → Each agent badge animates in with its spawn reason (300ms stagger)
  → 800ms pause after last badge
  → Mock findings populate right panel (staggered, critical first)
  → Timing shown in footer: "Completed in Xs"
```

### Claude orchestrator call

One real API call to `claude-haiku-4-5-20251001` (fast, cheap, sufficient for classification):

**Input:** URL string or base64 image (if screenshot uploaded)

**Prompt:**
```
You are a UX audit orchestrator. Analyze this page and return a JSON object only — no other text.

Page: {url or "uploaded screenshot"}

Return:
{
  "page_type": "one of: landing_page | saas_app | checkout_flow | content_page | form_page | other",
  "agents_to_spawn": ["heuristics", "accessibility", "forms"],  // always include heuristics; add others based on page
  "agent_reasons": {
    "heuristics": "always",
    "accessibility": "reason why included or omitted",
    "forms": "reason why included or omitted",
    "copy": "reason why included or omitted"
  },
  "reasoning": "one sentence describing the page"
}

Rules:
- Always include "heuristics"
- Include "accessibility" when a URL is provided (DOM likely available)
- Include "forms" when page_type is checkout_flow or form_page
- Include "copy" only when page_type is landing_page
```

**Error handling:** If the API call fails or returns malformed JSON, fall back to spawning heuristics only, show a subtle "Classification unavailable — running heuristics audit" notice, and still render the full mock heuristics findings pool in the right panel.

**Screenshot input format:** When a screenshot is uploaded, read it as base64 via `FileReader`, then send it as a `image` content block in the Claude API messages array: `{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "<base64>" } }`. Include a text block instructing Claude to classify the page from the image.

### Mock findings

Pre-written realistic findings keyed by agent. The synthesizer selects findings based on which agents were spawned and sorts by severity.

Each finding shape:
```js
{
  agent: "heuristics" | "accessibility" | "forms" | "copy",
  heuristic: "H6 Recognition not recall",  // agent-specific label
  severity: "critical" | "major" | "minor",
  title: "No visible focus states on interactive elements",
  description: "Nav links, form inputs, and buttons have no visible focus ring — keyboard users cannot track position.",
  location: "Global — all interactive elements",
  fix: "Add :focus-visible outline of at least 2px to all interactive elements"
}
```

Mock finding pools:
- **Heuristics:** 6 findings (2 critical, 2 major, 2 minor) covering H1–H10
- **Accessibility:** 4 findings (1 critical, 2 major, 1 minor) covering WCAG 1.4.3, 2.1.1, 1.1.1
- **Forms:** 4 findings (1 critical, 2 major, 1 minor) covering labels, error states, CTA placement
- **Copy:** 3 findings (0 critical, 1 major, 2 minor) covering ambiguous labels, microcopy gaps

Synthesizer logic (client-side JS):
- Collect findings from spawned agents only
- Sort by severity (critical → major → minor)
- Show top 5 by default; remainder behind "+ N more findings" toggle

---

## UI components

### Top bar
- App name: "UX Audit Agency" (bold, tight tracking)
- Subtitle: "Powered by Claude" (muted)
- API key input: right-aligned, password-type, placeholder `sk-ant-...`

### Left panel (340px fixed width)

**Before audit:**
- URL text input with placeholder
- "or" divider
- Screenshot drop zone (dashed border, accepts image files)
- "Run audit" button (black, full width)

**After audit (sequential reveal):**
- Section label: ORCHESTRATOR
- Page classification label (e.g. "SaaS Checkout Flow")
- Agent list — each row: dot indicator + agent name + spawn reason
  - Spawned: filled black dot
  - Skipped: empty/gray dot, name muted
- Completion time in footer

### Right panel (flex-fill)

**Before audit:** Empty state — "Paste a URL or upload screenshots to begin."

**After audit:**
- Section label: FINDINGS + count
- "sorted by severity" right-aligned label
- Finding rows, separated by thin horizontal rules:
  - Severity dot + severity label + agent + heuristic/category
  - Title (bold)
  - Description
  - Location (muted)
  - Fix (gray background, code-style for any inline code)
- "+ N more findings" collapse toggle

### Animation sequence
1. "Run audit" click → button text becomes "Analyzing..." + disabled
2. API call fires
3. On response: "Page classified as [type]" fades in
4. Agent badges stagger in one at a time, 300ms apart
5. 800ms pause
6. Right panel: "Generating findings..." label appears briefly
7. Findings stagger in 200ms apart, critical first
8. Button re-enables; time shown

---

## Scope

**In:**
- URL input → real Claude classification call
- Screenshot upload → base64 to Claude vision
- Sequential agent reveal animation
- Mock findings from all four agent pools
- Findings sorted by severity, top 5 visible, rest collapsible
- API key input in UI
- Error state for failed API calls

**Out (explicitly):**
- Real agent analysis (heuristics, accessibility, forms, copy are all mock)
- Fetching or screenshotting the actual URL (CORS-constrained; classification is based on URL string and Claude's reasoning)
- Saving results or history
- Exporting/downloading the report
- Mobile layout

---

## Files to create

```
demos/ux-audit-agency/
└── index.html     ← entire app, self-contained
```

No other files needed.

---

## Open questions (resolved)

All design questions resolved during brainstorming. No blockers before implementation.

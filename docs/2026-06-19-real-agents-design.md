# Design Spec: Real Audit Agents

**Date:** 2026-06-19
**Status:** Approved (pending spec review)
**File:** `index.html` (single-file, no build)
**Supersedes:** mock `synthesize()` behavior from the 2026-06-09 prototype spec

---

## What we're building

Turn the UX Audit Agency's animated-but-fake agents into **real subagents**. Today the orchestrator classifies the page and `synthesize()` returns pre-written mock findings. After this change, each spawned agent makes its **own Claude API call** that actually analyzes the input and returns real findings. Every finding is labeled with its **provenance** (real / inferred / fallback) so the user always knows how much to trust it.

Everything stays in `index.html`. No build step, no server.

---

## Decisions made

| Decision | Choice | Reason |
|---|---|---|
| Analysis input | Screenshots → real vision analysis; URLs → Claude reasoning from the URL/its knowledge (not the live page) | Browser can't fetch cross-origin DOM; no server allowed |
| Agent execution | One Claude call **per spawned agent**, run in **parallel** (`Promise.all`) | True multi-agent; matches per-agent animation; latency = slowest call, not sum |
| Agent roster | 7 agents (see below) | Core 4 + Visual, Conversion, Mobile fill the biggest gaps |
| Failure handling | Per-agent fallback to mock `FINDINGS` library; classify failure → heuristics-only | Demo never looks broken |
| Provenance | Three labels: **REAL / INFERRED / FALLBACK**, stamped by the execution path | Honest transparency; agents can't self-declare |
| Model | `claude-haiku-4-5-20251001` (unchanged) | Has vision; cheap/fast enough for up to 7 parallel calls |
| Style | Minimal/editorial, no color fills | Match existing prototype |

---

## Architecture — three layers

```
USER (URL or screenshot + API key → Run audit)
        │
  CONTEXT LAYER ── "what is true about this page?"
    • normalize input (image→base64 | URL→text)
    • classify() → page_type
    • derive flags: image available? looks mobile? live DOM (real vs inferred)?
    → shared context object handed to every agent
        │
  REASONING LAYER ── "who looks, and through what lens?"
    • orchestrator applies spawn rules → agents_to_spawn + reasons
    • each spawned agent reasons over the SAME context via its own system prompt
        │
  CAPABILITY LAYER ── "do the work, produce the result"
    • fire N agent calls in parallel (Promise.all), each → findings[]
    • stamp each finding's source (real | inferred | fallback)
    • failed agent → mock FINDINGS fallback
    • merge + sort critical→major→minor → renderFindings()
        │
USER sees spawned agents (+ skip reasons) and provenance-labeled findings
```

**Code mapping:**

| Layer | In `index.html` |
|---|---|
| Context | `classify()` + input normalization → context object |
| Reasoning | spawn rules + 7 per-agent system prompts |
| Capability | `runAgents()` (parallel calls), source-stamping, fallback, sort, `renderFindings()` |

The seam: Context produces one shared object; Reasoning decides and analyzes over it; Capability executes and renders. Adding an agent touches only Reasoning; swapping the model touches only Capability.

---

## The agents

| Agent | Spawns when | Lens |
|---|---|---|
| **Heuristics** | always | Nielsen's 10 — status visibility, match to real world, error prevention, consistency, recognition vs recall |
| **Accessibility** | always | Vision: contrast, text size, touch-target size, visible labels. URL: inferred WCAG risks |
| **Visual / hierarchy** | screenshot present | spacing, alignment, typographic scale, CTA visual weight, whitespace, grid |
| **Forms / Flow** | `checkout_flow` or `form_page` | field count, labels, inline validation, error states, progress, friction |
| **Copy** | `landing_page` or `content_page` | clarity, jargon, value-prop strength, scannability, microcopy, CTA verbs |
| **Conversion / CTA** | `landing_page` or `checkout_flow` | primary-action prominence, trust signals, social proof, friction-to-convert |
| **Mobile / responsive** | screenshot looks mobile (classifier judges) | touch targets, thumb reach, tap spacing, viewport fit |

- **Visual** and **Mobile** require an image. On URL-only input they auto-skip with a clear reason (e.g. "no screenshot — visual inspection unavailable").
- `ALL_AGENTS`, `AGENT_LABELS`, the classifier's `agent_reasons` shape, and its rule list all expand from 4 → 7 entries.

---

## Finding output contract

Every agent returns an array of findings in the **existing shape**, plus one new field:

```js
{
  agent,        // e.g. "visual"
  category,     // e.g. "Visual hierarchy"
  severity,     // "critical" | "major" | "minor"
  title,
  description,
  location,
  fix,
  source        // NEW: "real" | "inferred" | "fallback"  (stamped by Capability layer)
}
```

`renderFindings()` continues to sort critical→major→minor across all agents combined.

---

## Provenance labeling

The Capability layer stamps `source` based on the execution path (not the agent's say-so):

| `source` | Meaning | When |
|---|---|---|
| `real` | Claude analyzed the actual pixels | screenshot input, call succeeded |
| `inferred` | Claude reasoned from the URL / its knowledge, not the live page | URL input, call succeeded |
| `fallback` | pre-written sample finding | any input, agent call failed |

**Rendering:**
- Small uppercase tag on each finding row, minimal style, no color fills.
- `REAL` / `INFERRED` muted gray; `FALLBACK` gets a thin border so lower-trust findings read honestly.
- When any fallback is present, a one-line banner above the findings: *"Some findings are sample data — N agent(s) couldn't complete."*

---

## Resilience

1. `classify()` fails → existing heuristics-only fallback (`FALLBACK_RESULT`).
2. A single agent call fails → that agent's findings come from the mock `FINDINGS` library, stamped `fallback`. Other agents unaffected.
3. The mock `FINDINGS` database is retained — it changes role from primary source to **fallback library**.

---

## Out of scope

- Server/proxy to fetch live URL DOM (would break single-file/no-build).
- Performance auditing (needs real load metrics).
- Persisting or exporting reports.
- Multi-screenshot synthesis (first uploaded file is analyzed, as today).

---
name: annotation-renderer
description: Render an annotated screenshot for a UX audit — numbered pins drawn on the full-page screenshot at each finding's location, where pin numbers match the synthesizer's severity ranking exactly. Use this after the synthesizer has produced its ranked findings list and a page screenshot exists from page-inspector. Triggers include: "annotate the screenshot", "render the visual companion", "draw the pins", "mark the findings on the page", "generate the annotated audit image", or any time the final audit report needs its visual companion.
---

# Annotation Renderer

This skill draws numbered pins onto the full-page screenshot captured by
`page-inspector`, at the location of each ranked finding, producing the visual
companion to the audit report. Pin #1 on the image is finding #1 in the report.

This is a rendering skill. It makes NO UX judgments — it draws what the
synthesizer already decided. If a finding lacks a resolvable location, this
skill flags it back; it never guesses where an issue lives.

## When to use

Use after the synthesizer has produced its final ranked findings and only when
a screenshot exists (URL-based audits via page-inspector, or an uploaded
screenshot with locatable findings). Do NOT run before ranking is final —
pin numbers must match the report exactly, and re-rendering after a rank
change is cheap but confusing mid-flow.

## Inputs

1. `screenshot_path` — full-page PNG from page-inspector.
2. `viewport` — { width, height, scroll_height } of the capture, for
   coordinate mapping.
3. `findings` — the synthesizer's ranked array. Each finding MUST include a
   structured `location`:

```json
{
  "rank": 1,
  "severity": "critical",
  "agent": "accessibility",
  "issue": "string",
  "location": {
    "type": "bbox",
    "x": 0, "y": 0, "width": 0, "height": 0,
    "selector": "optional CSS selector for traceability"
  }
}
```

`location.type` may be `"bbox"` (preferred, from the DOM/accessibility tree)
or `"region"` (fallback: one of `header`, `nav`, `main`, `footer`, `form`,
with the region's bbox resolved from page-inspector's landmark data).

## Procedure

1. **Validate locations first.** Every finding must resolve to a bbox. Collect
   any that don't into `unplaced[]` and continue — never invent coordinates.

2. **Compute pin anchor points.** Default anchor is the top-left corner of the
   bbox, inset by 8px. If the bbox is large (> 40% of viewport width), anchor
   at its top-center instead so the pin reads as "this whole area."

3. **Cluster overlapping pins.** If two anchors fall within 48px of each
   other, offset the later (lower-ranked) pin along a small spiral until
   clear. If more than 4 pins land in one 200px region, collapse them into a
   single cluster pin labeled with the range (e.g. "3–6") and note the
   cluster in the output manifest.

4. **Draw.** For each finding, on a copy of the screenshot (never mutate the
   original):
   - A filled circle pin (28px diameter) with the rank number centered.
   - Pin color by severity: critical = red family, major = amber family,
     minor = neutral gray. Use accessible contrast for the number.
   - A 2px outline stroke around the finding's bbox in the same severity
     color at 60% opacity, so the pin shows *where* and the outline shows
     *what extent*.
   - Only critical and major findings are pinned; minor findings are recorded
     in `skipped[]` and never drawn.

5. **Render a legend strip** along the bottom or right edge: pin number,
   severity dot, and truncated issue title (max 60 chars), in rank order.

6. **Output.** Write the annotated PNG alongside the original. Return the
   manifest (below), never prose narration.

## Output contract

```json
{
  "annotated_screenshot_path": "string",
  "original_screenshot_path": "string",
  "pins": [
    { "rank": 1, "x": 0, "y": 0, "severity": "critical", "clustered": false }
  ],
  "clusters": [
    { "ranks": [3, 4, 5], "x": 0, "y": 0 }
  ],
  "unplaced": [
    { "rank": 7, "reason": "no resolvable location" }
  ],
  "skipped": [
    { "rank": 8, "severity": "minor" }
  ]
}
```

`unplaced` findings still appear in the text report — they are simply listed
under the image as "not shown" rather than silently dropped or guessed.

`skipped` lists findings that were not pinned because their severity is below
the critical/major threshold — minor findings are never drawn on the image.

## Implementation notes

- Use a deterministic drawing library (e.g. Pillow in Python or
  node-canvas in JS) — same inputs must always produce the same image, so
  the eval set can diff outputs.
- Long pages: if scroll_height exceeds ~3 viewports, render the annotated
  image at full page height but also emit per-viewport crops for any pin
  below the first fold, so the report can show findings in context.
- Keep pin geometry, colors, and fonts as constants at the top of the
  implementation — they are design tokens for the report, not per-run
  decisions.

## Guardrails

- NEVER guess a location. Unresolvable findings go to `unplaced[]`.
- NEVER reorder, drop, or renumber findings — rank comes from the
  synthesizer and is immutable here.
- NEVER add, merge, or edit issue text — truncation for the legend is the
  only permitted transformation.
- This skill runs after ranking is final. If called with unranked findings,
  return an error rather than assigning numbers.

## Reference implementation

`render.py` in this directory is a deterministic Pillow implementation of the
Procedure above. Run it as:

```
python3 render.py <screenshot_path> <findings_json> [--viewport-width N]
```

It writes `<screenshot>.annotated.png` beside the original and prints the
manifest JSON to stdout. `sample-findings.json` is a worked example against a
1200×742 capture of example.com.

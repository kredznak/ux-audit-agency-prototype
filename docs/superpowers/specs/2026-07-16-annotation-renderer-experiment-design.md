# Annotation Renderer — Standalone Experiment

**Date:** 2026-07-16
**Status:** approved for build
**Scope:** quick standalone experiment (NOT pipeline integration)

## Goal

Validate the `annotation-renderer` skill by rendering one annotated screenshot
by hand — numbered pins drawn on a full-page screenshot, one per ranked
finding, pin number matching the finding's rank. Decide from the result whether
it is worth wiring into the live audit pipeline.

## What we build

1. **Install the skill** — `.claude/skills/annotation-renderer/SKILL.md` (the
   provided skill content, verbatim) so it is a real, invokable skill.

2. **Renderer** — `.claude/skills/annotation-renderer/render.py`, a
   Python/Pillow implementation of the skill's Procedure:
   - Validate every finding resolves to a bbox; unresolved → `unplaced[]`.
   - Pin anchor = bbox top-left inset 8px; top-center if bbox width > 40% of
     viewport width.
   - Cluster: anchors within 48px offset along a small spiral; >4 pins in one
     200px region collapse to a single range-labeled cluster pin.
   - Draw on a **copy** of the screenshot: 28px filled circle pin with centered
     rank number; severity color (high=red, medium=amber, low=gray); 2px bbox
     outline at 60% opacity in the same color.
   - Legend strip along the bottom: pin number, severity dot, truncated issue
     title (≤60 chars), in rank order.
   - Write annotated PNG beside the original; emit the JSON manifest
     (`annotated_screenshot_path`, `original_screenshot_path`, `pins`,
     `clusters`, `unplaced`).
   - Design tokens (colors, sizes, fonts) as constants at the top.

3. **Sample inputs** — `.claude/skills/annotation-renderer/sample-findings.json`:
   3–4 ranked findings with real bboxes measured against `example-com-full.png`
   (1200×742). Includes one `region`-type location (fallback path) and one
   finding with no location (exercises `unplaced[]`).

4. **Run + show** — render, then display the annotated PNG for judgment.

## Why Pillow

The skill names Pillow or node-canvas. node-canvas is not installed (native
build); Pillow 11.1.0 is ready now and deterministic (same inputs → identical
image), which the skill wants for eval diffing.

## Out of scope

No changes to the pipeline, synthesizer, finding contract, `src/server.ts` SSE,
or `index.html`. The structured-bbox gap in the finding contract (locations are
currently free-text strings) is noted but NOT solved here — that is the
integration pass, decided after seeing this experiment.

## Success criteria

- Renderer runs deterministically with no new installs.
- Annotated PNG shows correctly-numbered, severity-colored pins at the sample
  locations, plus a legend, plus the `unplaced` finding surfaced in the manifest
  rather than silently dropped.

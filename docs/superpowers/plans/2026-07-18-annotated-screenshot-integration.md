# Annotated Screenshot Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third column to the UX Audit Agency UI that shows the audited screenshot with numbered pins on each critical/major finding, interactively linked to the findings list.

**Architecture:** For screenshot-upload audits (Milestone 1), after the existing agent pipeline returns ranked findings, the server runs one extra vision "locator" call that returns a normalized bounding box for each critical/major finding. The server attaches those boxes to the findings it already streams. The browser renders the uploaded image in a new third column and draws DOM pin overlays from the boxes — pins are interactive (hover/click links a finding to its pin), so pins are drawn in the DOM, not baked into the image. `render.py` (the standalone annotation-renderer skill) is updated to enforce the same critical/major rule for its static-export path but is NOT on the interactive UI path.

**Tech Stack:** TypeScript (ESM, run via `tsx`), Node built-in `http` + Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), single-file `index.html` (vanilla JS), Python 3 + Pillow for `render.py`. Tests: Node built-in `node:test` (run through `tsx`) and Python built-in `unittest`. No new runtime dependencies.

## Global Constraints

- Keep all UI in the single `index.html` — no splitting into multiple files. (CLAUDE.md)
- Preserve the minimal/editorial style: no color fills, high contrast, typography-first. Use the existing CSS tokens in `index.html` (`--red #dc2626` = critical, `--amber #d97706` = major, `--gray-400` = minor, `--black`, `--white`, `--gray-*`). (CLAUDE.md)
- Severity vocabulary is **`critical | major | minor`** everywhere (the synthesizer contract). `render.py` currently uses `high/medium/low` and MUST be migrated to `critical/major/minor`.
- **Pin-eligibility rule:** a finding gets a pin **iff** `severity ∈ {critical, major}` **AND** it has a resolvable bounding box. Minor findings are never pinned. Pin numbers equal the finding's rank (its 0-based index in the ranked list, displayed as index+1) and are never renumbered.
- Model for any Claude call: `claude-haiku-4-5-20251001` (or `process.env.AUDIT_MODEL` if set), matching the existing pipeline.
- No new npm or pip dependencies. Tests use `node:test` and Python `unittest` only.
- Add an npm script `"test": "node --import tsx --test src/*.test.ts"` for the Node tests.

**Milestone 1 scope:** the **screenshot-upload** audit path only. URL audits keep working exactly as today and simply do not show the third column (no client-side image, no DOM bboxes yet). URL/DOM-bbox pinning is deferred — see "Future Work".

---

### Task 1: Migrate `render.py` to critical/major/minor + enforce the pin rule

Makes the standalone annotation-renderer skill speak the product's severity vocabulary and enforce the critical/major-only rule, so its static output and the eval set stay consistent with the app. Refactors the render body into a testable function.

**Files:**
- Modify: `.claude/skills/annotation-renderer/render.py`
- Test: `.claude/skills/annotation-renderer/test_render.py` (create)

**Interfaces:**
- Produces: `render(spec: dict, screenshot_path: str) -> dict` — writes `<screenshot>.annotated.png` beside the original and returns the manifest `{annotated_screenshot_path, original_screenshot_path, pins, clusters, unplaced, skipped}`. `spec` may include `"normalized": true` (bbox x/width are fractions of image width, y/height fractions of image height).

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/annotation-renderer/test_render.py`:

```python
import json, os, tempfile, unittest
from PIL import Image
import render  # render.py in the same directory


class RenderRuleTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.shot = os.path.join(self.dir, "shot.png")
        Image.new("RGB", (400, 300), "white").save(self.shot)

    def _spec(self):
        return {
            "viewport": {"width": 400, "height": 300, "scroll_height": 300},
            "findings": [
                {"rank": 1, "severity": "critical", "agent": "a", "issue": "crit here",
                 "location": {"type": "bbox", "x": 10, "y": 10, "width": 80, "height": 20}},
                {"rank": 2, "severity": "major", "agent": "b", "issue": "major no loc",
                 "location": None},
                {"rank": 3, "severity": "minor", "agent": "c", "issue": "minor here",
                 "location": {"type": "bbox", "x": 10, "y": 100, "width": 80, "height": 20}},
            ],
        }

    def test_only_critical_and_major_are_pinned(self):
        m = render.render(self._spec(), self.shot)
        pinned = {p["rank"] for p in m["pins"]}
        self.assertEqual(pinned, {1})                      # crit with a box
        self.assertEqual({u["rank"] for u in m["unplaced"]}, {2})   # major, no box
        self.assertEqual({s["rank"] for s in m["skipped"]}, {3})    # minor, by rule
        self.assertTrue(os.path.exists(m["annotated_screenshot_path"]))

    def test_normalized_coords_scale_to_pixels(self):
        spec = self._spec()
        spec["normalized"] = True
        spec["findings"][0]["location"] = {"type": "bbox", "x": 0.5, "y": 0.5, "width": 0.25, "height": 0.1}
        m = render.render(spec, self.shot)
        pin = next(p for p in m["pins"] if p["rank"] == 1)
        self.assertGreater(pin["x"], 150)   # 0.5*400 = 200-ish region, not a raw 0.5px
        self.assertGreater(pin["y"], 130)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .claude/skills/annotation-renderer && python3 -m unittest test_render -v`
Expected: FAIL — `render` has no attribute `render` (module currently only defines `main`), and severity keys are `high/medium/low`.

- [ ] **Step 3: Update severity tokens and eligibility constants in `render.py`**

Replace the `SEV_COLORS` / `DEFAULT_SEV` block near the top of `render.py` with:

```python
# Severity -> (pin fill, number color). Matches index.html tokens.
SEV_COLORS = {
    "critical": ((0xDC, 0x26, 0x26), (0xFF, 0xFF, 0xFF)),
    "major":    ((0xD9, 0x77, 0x06), (0xFF, 0xFF, 0xFF)),
    "minor":    ((0x6B, 0x72, 0x80), (0xFF, 0xFF, 0xFF)),
}
DEFAULT_SEV = "minor"
PIN_ELIGIBLE = {"critical", "major"}   # minor findings are never pinned
```

- [ ] **Step 4: Extract a testable `render()` and apply the rule**

In `render.py`, refactor `main()` so the drawing logic lives in `render(spec, screenshot_path)`. Replace the body of `main()` from `spec = json.loads(...)` onward, and add the new function. The classification loop becomes:

```python
def render(spec, screenshot_path):
    from pathlib import Path
    viewport = spec.get("viewport", {})
    landmarks = spec.get("landmarks", {})
    normalized = bool(spec.get("normalized", False))
    findings = spec["findings"]
    if any("rank" not in f for f in findings):
        raise ValueError("findings are unranked — rank is assigned by the synthesizer, not here")
    findings = sorted(findings, key=lambda f: f["rank"])

    base = Image.open(screenshot_path).convert("RGBA")
    vw, vh = base.width, base.height

    def scaled(bbox):
        x, y, w, h = bbox
        return (x * vw, y * vh, w * vw, h * vh) if normalized else bbox

    placed, unplaced, skipped = [], [], []
    for f in findings:
        sev = sev_key(f)
        if sev not in PIN_ELIGIBLE:
            skipped.append({"rank": f["rank"], "severity": sev})
            continue
        bbox = resolve_bbox(f, landmarks)
        if bbox is None:
            unplaced.append({"rank": f["rank"], "reason": "no resolvable location"})
        else:
            placed.append((f, scaled(bbox)))

    viewport_w = float(viewport.get("width", vw))
    anchors = declutter([anchor_point(b, viewport_w) for _, b in placed])
    anchors = [(min(max(cx, PIN_R), base.width - PIN_R),
                min(max(cy, PIN_R), base.height - PIN_R)) for cx, cy in anchors]

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for (f, bbox), _ in zip(placed, anchors):
        x, y, w, h = bbox
        r, g, b = SEV_COLORS[sev_key(f)][0]
        odraw.rectangle([x, y, x + w, y + h], outline=(r, g, b, OUTLINE_ALPHA), width=OUTLINE_W)
    canvas = Image.alpha_composite(base, overlay)

    draw = ImageDraw.Draw(canvas)
    pin_font = load_font(15)
    pins = []
    for (f, bbox), (cx, cy) in zip(placed, anchors):
        fill, num_color = SEV_COLORS[sev_key(f)]
        draw_pin(draw, cx, cy, f["rank"], fill, num_color, pin_font)
        pins.append({"rank": f["rank"], "x": round(cx), "y": round(cy),
                     "severity": sev_key(f), "clustered": False})

    legend_font = load_font(14)
    legend_h = LEGEND_PAD * 2 + LEGEND_ROW_H * max(len(placed), 1)
    out = Image.new("RGBA", (canvas.width, canvas.height + legend_h), (255, 255, 255, 255))
    out.paste(canvas, (0, 0))
    ld = ImageDraw.Draw(out)
    ld.line([0, canvas.height, canvas.width, canvas.height], fill=(0, 0, 0, 40), width=1)
    ry = canvas.height + LEGEND_PAD
    for f, _ in placed:
        fill = SEV_COLORS[sev_key(f)][0]
        ld.ellipse([LEGEND_PAD, ry, LEGEND_PAD + 20, ry + 20], fill=fill)
        n = str(f["rank"])
        l, t, rr, bb = ld.textbbox((0, 0), n, font=legend_font)
        ld.text((LEGEND_PAD + 10 - (rr - l) / 2 - l, ry + 10 - (bb - t) / 2 - t), n,
                fill=SEV_COLORS[sev_key(f)][1], font=legend_font)
        title = f.get("issue", "")
        if len(title) > LEGEND_TITLE_MAX:
            title = title[:LEGEND_TITLE_MAX - 1] + "…"
        ld.text((LEGEND_PAD + 32, ry + 3), title, fill=(0x20, 0x20, 0x20), font=legend_font)
        ry += LEGEND_ROW_H

    out_path = Path(screenshot_path).with_suffix(".annotated.png")
    out.convert("RGB").save(out_path)
    return {
        "annotated_screenshot_path": str(out_path),
        "original_screenshot_path": str(screenshot_path),
        "pins": pins, "clusters": [], "unplaced": unplaced, "skipped": skipped,
    }
```

Then make `main()` a thin CLI wrapper:

```python
def main():
    import sys
    if len(sys.argv) < 3:
        print("usage: python3 render.py <screenshot_path> <findings_json>", file=sys.stderr)
        sys.exit(2)
    spec = json.loads(Path(sys.argv[2]).read_text())
    try:
        manifest = render(spec, sys.argv[1])
    except ValueError as e:
        print(json.dumps({"error": str(e)})); sys.exit(1)
    print(json.dumps(manifest, indent=2))
```

Keep `Path` imported at module top (`from pathlib import Path`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd .claude/skills/annotation-renderer && python3 -m unittest test_render -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Update `sample-findings.json` severities**

In `.claude/skills/annotation-renderer/sample-findings.json`, change each finding's `severity` from `high/medium/low` to `critical/major/minor` (`high→critical`, `medium→major`, `low→minor`). Then run `python3 render.py example-com-full.png .claude/skills/annotation-renderer/sample-findings.json` from the repo root and confirm it prints a manifest with a `skipped` array.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/annotation-renderer/render.py .claude/skills/annotation-renderer/test_render.py .claude/skills/annotation-renderer/sample-findings.json
git commit -m "feat(render): critical/major/minor severities + pin-eligibility rule + tests"
```

---

### Task 2: Vision locator module (`src/locator.ts`)

A pure-glue module that turns the uploaded screenshot + ranked critical/major findings into one normalized bounding box per finding. The Claude call is injected as a function so the logic is unit-testable.

**Files:**
- Create: `src/locator.ts`
- Test: `src/locator.test.ts`

**Interfaces:**
- Produces:
  - `interface NormBbox { x: number; y: number; width: number; height: number }`
  - `clampNormalizedBbox(raw: any): NormBbox | null` — returns the bbox if every field is a finite number within `[0,1]` and width/height > 0, else `null`.
  - `parseLocatorBoxes(json: any, count: number): (NormBbox | null)[]` — reads `{ boxes: [{ index, bbox }] }`, returns an array of length `count` aligned by `index` (missing/invalid → `null`).
  - `attachBboxes(findings: any[], boxes: (NormBbox | null)[]): void` — sets `findings[i].bbox = boxes[i]` (or `null`).
  - `locate(imagePath: string, findings: any[], runQuery: (prompt: string) => Promise<string>): Promise<(NormBbox | null)[]>` — builds the prompt, runs the query, parses the result.
  - `extractJson(text: string): any` — moved here from `server.ts` and re-exported (see Task 3).

- [ ] **Step 1: Write the failing test**

Create `src/locator.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampNormalizedBbox, parseLocatorBoxes, attachBboxes, locate } from "./locator.ts";

test("clampNormalizedBbox accepts valid, rejects out-of-range", () => {
  assert.deepEqual(clampNormalizedBbox({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }),
    { x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
  assert.equal(clampNormalizedBbox({ x: 1.5, y: 0.2, width: 0.3, height: 0.4 }), null);
  assert.equal(clampNormalizedBbox({ x: 0.1, y: 0.2, width: 0, height: 0.4 }), null);
  assert.equal(clampNormalizedBbox(null), null);
});

test("parseLocatorBoxes aligns by index and fills gaps with null", () => {
  const json = { boxes: [{ index: 0, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
                         { index: 2, bbox: null }] };
  const out = parseLocatorBoxes(json, 3);
  assert.equal(out.length, 3);
  assert.ok(out[0]);
  assert.equal(out[1], null);   // index 1 missing
  assert.equal(out[2], null);
});

test("attachBboxes writes bbox onto findings in order", () => {
  const findings = [{ title: "a" }, { title: "b" }];
  attachBboxes(findings, [{ x: 0, y: 0, width: 0.5, height: 0.5 }, null]);
  assert.deepEqual((findings[0] as any).bbox, { x: 0, y: 0, width: 0.5, height: 0.5 });
  assert.equal((findings[1] as any).bbox, null);
});

test("locate parses a stubbed query response", async () => {
  const stub = async () => '```json\n{"boxes":[{"index":0,"bbox":{"x":0.1,"y":0.1,"width":0.2,"height":0.2}}]}\n```';
  const boxes = await locate("/tmp/x.png", [{ title: "a" }], stub);
  assert.deepEqual(boxes, [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './locator.ts'`.

- [ ] **Step 3: Implement `src/locator.ts`**

```ts
export interface NormBbox { x: number; y: number; width: number; height: number }

/** Pull the last ```json fenced block (or a bare object) out of model text. */
export function extractJson(text: string): any {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidate = fences.length
    ? fences[fences.length - 1][1]
    : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate.trim());
}

const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

export function clampNormalizedBbox(raw: any): NormBbox | null {
  if (!raw || typeof raw !== "object") return null;
  const x = num(raw.x), y = num(raw.y), w = num(raw.width), h = num(raw.height);
  if ([x, y, w, h].some(Number.isNaN)) return null;
  if (x < 0 || y < 0 || x > 1 || y > 1 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, width: w, height: h };
}

export function parseLocatorBoxes(json: any, count: number): (NormBbox | null)[] {
  const out: (NormBbox | null)[] = Array.from({ length: count }, () => null);
  const boxes = Array.isArray(json?.boxes) ? json.boxes : [];
  for (const b of boxes) {
    const i = Number(b?.index);
    if (Number.isInteger(i) && i >= 0 && i < count) out[i] = clampNormalizedBbox(b?.bbox);
  }
  return out;
}

export function attachBboxes(findings: any[], boxes: (NormBbox | null)[]): void {
  findings.forEach((f, i) => { f.bbox = boxes[i] ?? null; });
}

function locatePrompt(imagePath: string, findings: any[]): string {
  const list = findings.map((f, i) =>
    `${i}. [${f.severity}] ${f.title} — ${f.location ?? ""}`).join("\n");
  return (
    `Read the screenshot image at this path: ${imagePath}\n\n` +
    `Below is a numbered list of UX findings about that screenshot. For each one, return the ` +
    `bounding box of the element or region it refers to, as NORMALIZED coordinates in [0,1] ` +
    `where x,y is the top-left corner and width,height are fractions of the image size. ` +
    `If you cannot confidently locate a finding, return null for its bbox — never guess.\n\n` +
    `${list}\n\n` +
    `Output ONLY this JSON in a single \`\`\`json block:\n` +
    `{"boxes":[{"index":0,"bbox":{"x":0,"y":0,"width":0,"height":0}},{"index":1,"bbox":null}]}`
  );
}

export async function locate(
  imagePath: string,
  findings: any[],
  runQuery: (prompt: string) => Promise<string>,
): Promise<(NormBbox | null)[]> {
  if (!findings.length) return [];
  const text = await runQuery(locatePrompt(imagePath, findings));
  return parseLocatorBoxes(extractJson(text), findings.length);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (4 tests in `locator.test.ts`).

- [ ] **Step 5: Add the test script to `package.json`**

In `package.json` `"scripts"`, add: `"test": "node --import tsx --test src/*.test.ts"`. (If it already exists from a prior task, skip.)

- [ ] **Step 6: Commit**

```bash
git add src/locator.ts src/locator.test.ts package.json
git commit -m "feat(locator): vision locator + normalized-bbox parsing with tests"
```

---

### Task 3: Wire the locator into the server and stream bboxes

After a screenshot audit's synthesis, run the locator for the critical/major findings, attach the boxes, and include them in the `findings` SSE event. URL audits are unaffected.

**Files:**
- Modify: `src/server.ts`
- Test: `src/server.test.ts` (create)

**Interfaces:**
- Consumes: `locate`, `attachBboxes`, `extractJson` from `./locator.ts` (Task 2).
- Produces: `normalize(payload)` now includes `bbox: NormBbox | null` on each finding; the `findings` SSE event payload carries `bbox` per finding. `runAudit(prompt, send, ac, imagePath?)` gains an optional `imagePath` — when present and synthesis succeeds, the server locates and attaches boxes before sending.

- [ ] **Step 1: Write the failing test for `normalize` bbox pass-through**

Create `src/server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "./server.ts";

test("normalize passes a bbox through to the card shape", () => {
  const payload = { findings: [
    { severity: "critical", title: "t", bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
    { severity: "minor", title: "u" },
  ] };
  const out = normalize(payload);
  assert.deepEqual(out.findings[0].bbox, { x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
  assert.equal(out.findings[1].bbox, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `normalize` is not exported from `./server.ts`, and running `server.ts` starts a listener. Both are fixed in Step 3.

- [ ] **Step 3: Refactor `server.ts` — export `normalize`, guard `listen`, use shared `extractJson`, add bbox**

In `src/server.ts`:

1. Replace the local `extractJson` definition with an import at the top:
   ```ts
   import { locate, attachBboxes, extractJson, type NormBbox } from "./locator.ts";
   ```
   and delete the old `function extractJson(...)` block.

2. Add `export` to `normalize` (`export function normalize(payload: any) { ... }`) and add `bbox` to each mapped finding:
   ```ts
   return {
     severity: SEVERITIES.has(sev) ? sev : "minor",
     agent: Array.isArray(f.agent) ? f.agent.join(" + ") : (f.agent ?? "audit"),
     category: String(ref).split(";")[0].trim(),
     title: f.title ?? "",
     description: f.description ?? f.evidence ?? "",
     location: f.location ?? "",
     fix: f.fix ?? f.recommendation ?? "",
     source: String(f.source ?? f.provenance ?? "real").toLowerCase(),
     bbox: (f.bbox ?? null) as NormBbox | null,
   };
   ```

3. Guard the server startup so importing the module in a test does not open a port. Change the final `server.listen(...)` block to:
   ```ts
   if (process.env.NODE_ENV !== "test") {
     server.listen(PORT, () => {
       console.log(`\n  UX Audit server → http://localhost:${PORT}\n`);
       if (!process.env.ANTHROPIC_API_KEY) {
         console.log("  (no ANTHROPIC_API_KEY — using the Claude Code login if available)\n");
       }
     });
   }
   ```
   and add `NODE_ENV=test` to the test script: `"test": "NODE_ENV=test node --import tsx --test src/*.test.ts"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (`normalize` bbox test + the Task 2 tests).

- [ ] **Step 5: Add the locator call to `runAudit`**

In `src/server.ts`, change the `runAudit` signature and the success branch. Update the signature:

```ts
async function runAudit(prompt: string, send: (e: SseEvent) => void, ac: AbortController, imagePath?: string): Promise<void> {
```

Add a query runner for the locate call (place it just inside `runAudit`, before the `for await` loop):

```ts
const runLocatorQuery = (p: string) => new Promise<string>((resolve, reject) => {
  (async () => {
    try {
      const q = query({ prompt: p, options: {
        abortController: ac,
        settingSources: ["project"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        ...(process.env.AUDIT_MODEL ? { model: process.env.AUDIT_MODEL } : {}),
      }});
      for await (const m of q) {
        if (m.type === "result") {
          if (m.subtype === "success") resolve((m as any).result);
          else reject(new Error(`locate failed: ${m.subtype}`));
        }
      }
    } catch (e) { reject(e as Error); }
  })();
});
```

In the `msg.type === "result"` / `msg.subtype === "success"` branch, after `payload = extractJson(msg.result);` and before `send({ type: "findings", ... })`, insert:

```ts
// Screenshot audits only: locate critical/major findings on the uploaded image.
if (imagePath && Array.isArray(payload?.findings)) {
  const eligible = payload.findings.filter(
    (f: any) => ["critical", "major"].includes(String(f.severity).toLowerCase()));
  if (eligible.length) {
    try {
      const boxes = await locate(imagePath, eligible, runLocatorQuery);
      attachBboxes(eligible, boxes);
    } catch (err) {
      send({ type: "note", message: `annotation skipped: ${String(err)}` });
    }
  }
}
```

- [ ] **Step 6: Pass `imagePath` through the request handler**

In the request handler, find the `await runAudit(prompt, send, ac);` call (inside the `try` after building the prompt) and change it to pass the screenshot path:

```ts
await runAudit(prompt, send, ac, image ? shotPath! : undefined);
```

- [ ] **Step 7: Manually verify the server still boots**

Run: `npm run serve` (Ctrl-C after it prints the URL).
Expected: prints `UX Audit server → http://localhost:4000` with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/server.ts src/server.test.ts package.json
git commit -m "feat(server): locate critical/major findings on screenshot audits + stream bboxes"
```

---

### Task 4: Third column — image + pin overlay in `index.html`

Add the annotated screenshot column: the uploaded image with DOM pin overlays positioned from each finding's normalized bbox, applying the critical/major rule. This is the static render; interaction comes in Task 5.

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: the `findings` array from the SSE `findings` event, where each finding may have `bbox: {x,y,width,height} | null` (fractions of the image). The uploaded `File` is available as `uploadedFiles[0]`.
- Produces: `renderAnnotated(findings)` — populates `#annotatedPanel`; `PINNABLE = ['critical','major']`; each pin/box carries `data-p="<rank>"` and each finding row carries `data-f="<rank>"` (rank = index in the findings array).

- [ ] **Step 1: Add the third panel markup and CSS**

In `index.html`, change the panels container. Replace:
```html
    <div class="right-panel" id="rightPanel"></div>
  </div>
```
with:
```html
    <div class="center-panel" id="rightPanel"></div>
    <div class="annot-panel" id="annotatedPanel"></div>
  </div>
```

In the `<style>` block, replace the `.right-panel { ... }` rule with:
```css
    .center-panel { flex: 1; padding: 24px; overflow-y: auto; min-width: 0; }
    .annot-panel {
      width: 460px; flex-shrink: 0; border-left: 1px solid var(--gray-100);
      padding: 24px; overflow-y: auto; display: none;
    }
    .annot-panel.visible { display: block; }
    .annot-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
    .annot-note { font-size: 11px; color: var(--gray-400); margin-top: 12px; line-height: 1.4; }
    .annot-note b { color: var(--gray-600); font-weight: 600; }
    .shot { position: relative; width: 100%; border: 1px solid var(--gray-200); border-radius: 10px; overflow: hidden; }
    .shot img { display: block; width: 100%; height: auto; }
    .pin {
      position: absolute; width: 26px; height: 26px; border-radius: 50%; transform: translate(-50%, -50%);
      display: grid; place-items: center; color: var(--white); font-size: 13px; font-weight: 700;
      border: 2px solid var(--white); box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: pointer; z-index: 3;
      transition: transform 0.15s;
    }
    .pin.critical { background: var(--red); }
    .pin.major    { background: var(--amber); }
    .pinbox {
      position: absolute; border: 2px solid; border-radius: 4px; opacity: 0.55; z-index: 2;
      pointer-events: none; transition: opacity 0.15s;
    }
    .pinbox.critical { border-color: var(--red); }
    .pinbox.major    { border-color: var(--amber); }
    .pin.on { transform: translate(-50%, -50%) scale(1.18); box-shadow: 0 0 0 6px rgba(220,38,38,0.16), 0 4px 10px rgba(0,0,0,0.32); z-index: 5; }
    .pin.major.on { box-shadow: 0 0 0 6px rgba(217,119,6,0.18), 0 4px 10px rgba(0,0,0,0.32); }
    .pinbox.on { opacity: 1; }
    @media (max-width: 1180px) { .annot-panel { width: 100%; border-left: none; border-top: 1px solid var(--gray-100); } }
    @media (prefers-reduced-motion: reduce) { .pin, .pinbox { transition: none; } }
```

- [ ] **Step 2: Track the uploaded image URL**

In the drop-zone script block, after `uploadedFiles = images;` inside `handleFiles`, add:
```js
      if (window.auditImageUrl) URL.revokeObjectURL(window.auditImageUrl);
      window.auditImageUrl = URL.createObjectURL(images[0]);
```

- [ ] **Step 3: Add `renderAnnotated` to the renderer script block**

In the renderer `<script>` block (the one defining `renderFindings`), add:
```js
    const PINNABLE = ['critical', 'major'];

    function renderAnnotated(findings) {
      const panel = document.getElementById('annotatedPanel');
      // Only screenshot audits have a client-side image to annotate.
      if (!window.auditImageUrl) { panel.classList.remove('visible'); panel.innerHTML = ''; return; }

      const pinned = findings
        .map((f, i) => ({ f, rank: i + 1 }))
        .filter(({ f }) => PINNABLE.includes(f.severity) && f.bbox);

      const pinsHtml = pinned.map(({ f, rank }) => {
        const b = f.bbox;
        const cx = (b.x + b.width / 2) * 100, cy = (b.y + b.height / 2) * 100;
        return `
          <div class="pinbox ${f.severity}" data-p="${rank}"
               style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.width * 100}%;height:${b.height * 100}%"></div>
          <div class="pin ${f.severity}" data-p="${rank}" style="left:${cx}%;top:${cy}%">${rank}</div>`;
      }).join('');

      panel.innerHTML = `
        <div class="annot-head">
          <div class="section-label">Annotated page</div>
          <div class="findings-sort-label">pin # = finding #</div>
        </div>
        <div class="shot" id="shot">
          <img src="${window.auditImageUrl}" alt="Audited screenshot">
          ${pinsHtml}
        </div>
        <div class="annot-note">Pins mark <b>critical &amp; major</b> findings only · minors stay in the list</div>`;
      panel.classList.add('visible');
    }
```

- [ ] **Step 4: Call `renderAnnotated` when findings arrive**

In the run-handler `<script>` block, in the SSE handler, change the `findings` branch:
```js
          } else if (ev.type === 'findings') {
            document.querySelectorAll('#agentList .agent-reason')
              .forEach(el => el.textContent = 'done');
            renderFindings(ev.findings || []);
            renderAnnotated(ev.findings || []);
```
Also add a handler so the new `note` event doesn't fall through silently — after the `error` branch add:
```js
          } else if (ev.type === 'note') {
            console.info('Audit note:', ev.message);
```

- [ ] **Step 5: Give findings rows a stable id for linking**

In `renderFindings`, the rows already get `id="finding-${i}"`. Add a `data-f` attribute so pins can target them. Change both row templates:
```js
        html += `<div class="finding-row visible" id="finding-${i}" data-f="${i + 1}">${findingHtml(f)}</div>`;
```
and
```js
          `<div class="finding-row" id="finding-${VISIBLE + i}" data-f="${VISIBLE + i + 1}" style="display:none">${findingHtml(f)}</div>`
```

- [ ] **Step 6: Verify with a static fixture in a browser**

Create a throwaway check: run `npm run serve`, open `http://localhost:4000`, then in the browser console paste:
```js
window.auditImageUrl = 'clean-shopper-home.png';
renderFindings([{severity:'critical',agent:'a',category:'x',title:'t1',description:'d',location:'l',fix:'f',source:'real',bbox:{x:0.1,y:0.1,width:0.2,height:0.1}},
                {severity:'minor',agent:'b',category:'y',title:'t2',description:'d',location:'l',fix:'f',source:'real'}]);
renderAnnotated([{severity:'critical',bbox:{x:0.1,y:0.1,width:0.2,height:0.1}},{severity:'minor'}]);
```
Expected: the third column appears with one red pin near the top-left of the image and the note line; the minor finding has no pin.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(ui): third column with pin overlay from finding bboxes"
```

---

### Task 5: Filter toggle + finding↔pin interaction

Add the `All / On page` filter and the bidirectional hover/click link between finding rows and pins, matching the approved mock.

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `.finding-row[data-f]`, `.pin[data-p]`, `.pinbox[data-p]` from Task 4.
- Produces: `wireAnnotationLinks()` (idempotent; call at the end of `renderFindings`), a `#viewToggle` control, and a `.finding-row.hidden { display: none }` rule.

- [ ] **Step 1: Add toggle + interaction CSS**

In `<style>`, add:
```css
    .view-toggle { display: inline-flex; border: 1px solid var(--gray-200); border-radius: 6px; overflow: hidden; }
    .view-toggle button {
      font-family: var(--font); font-size: 11px; color: var(--gray-500); background: none; border: none;
      padding: 5px 10px; cursor: pointer;
    }
    .view-toggle button + button { border-left: 1px solid var(--gray-200); }
    .view-toggle button.on { background: var(--gray-100); color: var(--black); font-weight: 600; }
    .finding-row.hidden { display: none !important; }
    .finding-row.linkable { cursor: pointer; }
    .finding-row.active { background: var(--gray-50); }
    .np-tag { font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gray-400);
      border: 1px solid var(--gray-200); border-radius: 3px; padding: 1px 5px; margin-left: auto; }
```

- [ ] **Step 2: Render the toggle in the findings header**

In `renderFindings`, replace the `findings-header` block in the `html` template with:
```js
        <div class="findings-header">
          <div class="section-label">
            Findings <span class="findings-count">${findings.length} total</span>
          </div>
          <div class="view-toggle" id="viewToggle">
            <button class="on" data-view="all">All</button>
            <button data-view="page">On page <span id="onPageCount"></span></button>
          </div>
        </div>
```

- [ ] **Step 3: Mark non-pinned critical/major rows with a "not on page" tag**

In `findingHtml(f)`, replace the `source-tag` span with a computed tag. Change the meta block to:
```js
    function findingHtml(f, pinnedRank) {
      const tag = pinnedRank
        ? `<span class="source-tag">pin ${pinnedRank}</span>`
        : (PINNABLE.includes(f.severity) ? `<span class="np-tag">not on page</span>` : `<span class="source-tag ${f.source}">${escapeHtml(f.source || '')}</span>`);
      return `
        <div class="finding-meta">
          <div class="severity-dot ${f.severity}"></div>
          <span class="severity-label ${f.severity}">${f.severity}</span>
          <span class="finding-category">${escapeHtml(f.agent)} · ${escapeHtml(f.category)}</span>
          ${tag}
        </div>
        <div class="finding-title">${escapeHtml(f.title)}</div>
        <div class="finding-description">${escapeHtml(f.description)}</div>
        <div class="finding-location">Location: ${escapeHtml(f.location)}</div>
        <div class="finding-fix">Fix: ${escapeHtml(f.fix)}</div>
      `;
    }
```
Then in `renderFindings`, compute which ranks are pinned and pass it in. After computing `top`/`rest`, add:
```js
      const pinnedRanks = new Set(findings
        .map((f, i) => (PINNABLE.includes(f.severity) && f.bbox ? i + 1 : null))
        .filter(Boolean));
      const rankOf = (f) => findings.indexOf(f) + 1;
```
and change both `findingHtml(f)` calls to `findingHtml(f, pinnedRanks.has(rankOf(f)) ? rankOf(f) : null)`.

- [ ] **Step 4: Add `wireAnnotationLinks` and the filter, and call them**

At the end of `renderFindings` (after the show-more wiring), add:
```js
      document.getElementById('onPageCount').textContent = pinnedRanks.size;
      wireAnnotationLinks(pinnedRanks);
```
And define, in the same script block:
```js
    function setLinkActive(rank, on) {
      document.querySelectorAll(`[data-f="${rank}"]`).forEach(e => e.classList.toggle('active', on));
      document.querySelectorAll(`[data-p="${rank}"]`).forEach(e => e.classList.toggle('on', on));
    }

    function wireAnnotationLinks(pinnedRanks) {
      pinnedRanks.forEach(rank => {
        const row = document.querySelector(`.finding-row[data-f="${rank}"]`);
        if (row) {
          row.classList.add('linkable');
          row.addEventListener('mouseenter', () => setLinkActive(rank, true));
          row.addEventListener('mouseleave', () => setLinkActive(rank, false));
          row.addEventListener('click', () => {
            document.querySelector(`.pin[data-p="${rank}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            setLinkActive(rank, true);
          });
        }
      });
      document.querySelectorAll('.pin[data-p]').forEach(pin => {
        const rank = pin.getAttribute('data-p');
        pin.addEventListener('mouseenter', () => setLinkActive(rank, true));
        pin.addEventListener('mouseleave', () => setLinkActive(rank, false));
        pin.addEventListener('click', () => {
          document.querySelector(`.finding-row[data-f="${rank}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          setLinkActive(rank, true);
        });
      });

      const toggle = document.getElementById('viewToggle');
      if (toggle) toggle.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          toggle.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
          const pageOnly = btn.dataset.view === 'page';
          document.querySelectorAll('.finding-row').forEach(r => {
            const shown = !pageOnly || pinnedRanks.has(Number(r.getAttribute('data-f')));
            r.classList.toggle('hidden', !shown);
          });
          const more = document.getElementById('showMoreBtn');
          if (more) more.classList.toggle('hidden', pageOnly);
        });
      });
    }
```
Note: the show-more logic sets `display` inline on rest rows; the `On page` filter uses the `.hidden` class with `!important`, so it wins over inline `display:block`. When switching back to `All`, `.hidden` is removed and the show-more inline state resumes.

- [ ] **Step 5: Verify interaction and filter in the browser**

Run `npm run serve`, open the app, and in the console run the same fixture from Task 4 Step 6 but with two critical findings that have bboxes and one minor. Then:
```js
document.querySelector('.finding-row[data-f="1"]').dispatchEvent(new MouseEvent('mouseenter'));
console.log('pin on:', document.querySelector('.pin[data-p="1"]').classList.contains('on'));   // true
document.querySelector('#viewToggle button[data-view="page"]').click();
console.log('visible rows:', [...document.querySelectorAll('.finding-row:not(.hidden)')].length); // == number pinned
```
Expected: pin highlights on hover; the toggle narrows the list to pinned rows.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(ui): All/On-page filter + bidirectional finding<->pin linking"
```

---

### Task 6: End-to-end verification with a real audit

Confirm the whole loop works against the running server with a real screenshot upload.

**Files:** none (verification only).

- [ ] **Step 1: Run the server**

Run: `npm run serve`
Expected: `UX Audit server → http://localhost:4000`.

- [ ] **Step 2: Run a real screenshot audit**

Open `http://localhost:4000`, drop `clean-shopper-home.png` (or any product-page screenshot) into the drop zone, and click **Run audit**. Wait for completion (~30–60s; the locate call adds one short round-trip).

- [ ] **Step 3: Confirm the annotated column**

Expected, once findings render:
- The third column appears with the uploaded screenshot.
- Critical/major findings that were locatable have numbered pins whose numbers match their finding rows.
- Minor findings have no pins; critical/major findings that couldn't be located show a "not on page" tag.
- Hovering a finding highlights its pin and vice versa; the `On page` toggle filters the list.
- URL audits (enter a URL instead) still work and show **no** third column.

- [ ] **Step 4: Commit any doc note**

If anything needed adjusting, update this plan's "Future Work" and commit. Otherwise nothing to commit.

---

## Future Work (separate plans)

- **URL-path pins via DOM bboxes.** Extend `page-inspector` to emit a `boxes` map (selector → bbox) captured with Playwright `scale:"css"` and per-viewport screenshots for below-fold elements (both validated in the coordinate spike, 2026-07-16). Surface `screenshotRef` + `viewport` + `boxes` in the final JSON; the server joins finding selectors to boxes deterministically and sends the captured screenshot to the browser. This removes the vision-locate approximation for URL audits.
- **Static annotated export.** Offer a "Download annotated report" that runs `render.py` server-side (now rule-aligned) to bake pins into a PNG for sharing.
- **Distinguish "below the crop" from "cross-cutting"** in the "not on page" tag, once per-viewport capture exists.

---

## Self-Review

- **Spec coverage:** three-column layout (Tasks 4–5), critical/major-only pin rule (Tasks 1, 4), rank-locked pin numbers (Tasks 1, 4), All/On-page filter (Task 5), bidirectional finding↔pin linking (Task 5), "not on page" for unplaceable critical/major (Task 5), coordinate source for uploads (Tasks 2–3). URL/DOM-bbox and per-viewport (from the spike) are explicitly deferred to Future Work — noted, not dropped.
- **Placeholder scan:** every code step contains full code; no TODO/TBD.
- **Type consistency:** `NormBbox` defined in `locator.ts` and imported by `server.ts`; `clampNormalizedBbox`/`parseLocatorBoxes`/`attachBboxes`/`locate`/`extractJson` names used consistently across Tasks 2–3; `renderAnnotated`/`wireAnnotationLinks`/`PINNABLE`/`data-f`/`data-p` consistent across Tasks 4–5; severity keys `critical/major/minor` consistent across `render.py`, `server.ts`, and `index.html`.

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

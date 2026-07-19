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

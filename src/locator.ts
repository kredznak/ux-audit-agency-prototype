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
    `where x,y is the top-left corner and width,height are fractions of the image size.\n\n` +
    `Findings are usually phrased as a lack — "missing X", "lacks Y", "no Z", "weak/unclear W". ` +
    `That phrasing does NOT mean the element is absent: if the finding is about an element that ` +
    `is nonetheless VISIBLE in the screenshot (a button with no label, a CTA with weak styling, ` +
    `product cards with no score badge, a heading with vague copy), box that visible element or ` +
    `group. Use the finding's location hint after the "—" to find it. When it refers to several ` +
    `repeated elements (e.g. "each product card"), box the group that contains them.\n\n` +
    `Return null ONLY when there is no visible element or region to point at — a purely ` +
    `page-wide quality with no anchor, or something that should exist but is entirely absent ` +
    `from the layout. Never invent precise coordinates for something you cannot see.\n\n` +
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

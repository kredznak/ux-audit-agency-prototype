#!/usr/bin/env python3
"""
annotation-renderer — deterministic Pillow implementation.

Draws numbered pins onto a full-page screenshot, one per ranked finding, pin
number == finding rank. Makes NO UX judgments; it draws what it is handed and
flags anything it cannot place into `unplaced[]`. Same inputs -> identical
image (no randomness, no timestamps), so eval sets can diff outputs.

    python3 render.py <screenshot_path> <findings_json>

<findings_json> shape:
    {
      "viewport":  { "width": 1200, "height": 742, "scroll_height": 742 },
      "landmarks": { "main": {"x":..,"y":..,"width":..,"height":..}, ... },
      "findings":  [ { "rank", "severity", "agent", "issue", "location" }, ... ]
    }

Writes <screenshot>.annotated.png beside the original and prints the manifest
JSON to stdout.
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ── Design tokens (report-level constants, not per-run decisions) ────────────
PIN_D = 28                      # pin diameter (px)
PIN_R = PIN_D // 2
CORNER_OVERLAP = 4              # px the pin overlaps its bbox corner; the rest
                                # of the pin sits OUTSIDE so it never buries the
                                # element's own text
LARGE_FRAC = 0.40               # bbox wider than this * viewport -> top-center
CLUSTER_DIST = 48               # anchors within this get spiral-offset
OUTLINE_W = 2
OUTLINE_ALPHA = 153             # 60% of 255
LEGEND_ROW_H = 26
LEGEND_PAD = 16
LEGEND_TITLE_MAX = 60

# Severity -> (pin fill, number color). Amber uses a dark number for contrast.
SEV_COLORS = {
    "high":   ((0xD6, 0x2D, 0x4A), (0xFF, 0xFF, 0xFF)),
    "medium": ((0xE8, 0x9B, 0x1E), (0x20, 0x20, 0x20)),
    "low":    ((0x6B, 0x72, 0x80), (0xFF, 0xFF, 0xFF)),
}
DEFAULT_SEV = "low"

# macOS / cross-platform truetype fallbacks; Pillow default is last resort.
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNS.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def sev_key(finding):
    return finding.get("severity", DEFAULT_SEV) if finding.get("severity") in SEV_COLORS else DEFAULT_SEV


def resolve_bbox(finding, landmarks):
    """Return (x, y, w, h) or None. Never invents coordinates."""
    loc = finding.get("location")
    if not isinstance(loc, dict):
        return None
    t = loc.get("type")
    if t == "bbox":
        try:
            return (float(loc["x"]), float(loc["y"]), float(loc["width"]), float(loc["height"]))
        except (KeyError, TypeError, ValueError):
            return None
    if t == "region":
        region = landmarks.get(loc.get("region"))
        if region:
            return (float(region["x"]), float(region["y"]), float(region["width"]), float(region["height"]))
    return None


def anchor_point(bbox, viewport_w):
    """Pin center, tucked just OUTSIDE the bbox so it never buries the element's
    text. Above the top-center edge for wide bboxes; off the top-left corner
    (with a small overlap) otherwise."""
    x, y, w, _h = bbox
    if w > LARGE_FRAC * viewport_w:
        return (x + w / 2.0, y - PIN_R + CORNER_OVERLAP)
    return (x - PIN_R + CORNER_OVERLAP, y - PIN_R + CORNER_OVERLAP)


def declutter(anchors):
    """Spiral-offset any anchor within CLUSTER_DIST of an already-placed one.
    Deterministic: fixed spiral, processed in rank order."""
    placed = []
    for ax, ay in anchors:
        px, py = ax, ay
        step = 0
        while any(math.hypot(px - qx, py - qy) < CLUSTER_DIST for qx, qy in placed):
            step += 1
            angle = step * 2.399963  # golden angle (radians), fixed
            radius = CLUSTER_DIST * (1 + step * 0.15)
            px = ax + radius * math.cos(angle)
            py = ay + radius * math.sin(angle)
        placed.append((px, py))
    return placed


def draw_pin(draw, cx, cy, number, fill, num_color, font):
    draw.ellipse([cx - PIN_R, cy - PIN_R, cx + PIN_R, cy + PIN_R], fill=fill,
                 outline=(255, 255, 255), width=2)
    label = str(number)
    l, t, r, b = draw.textbbox((0, 0), label, font=font)
    draw.text((cx - (r - l) / 2 - l, cy - (b - t) / 2 - t), label, fill=num_color, font=font)


def main():
    if len(sys.argv) < 3:
        print("usage: python3 render.py <screenshot_path> <findings_json>", file=sys.stderr)
        sys.exit(2)

    shot_path = Path(sys.argv[1])
    spec = json.loads(Path(sys.argv[2]).read_text())
    viewport = spec.get("viewport", {})
    landmarks = spec.get("landmarks", {})
    findings = spec["findings"]

    # Ranking must be final: every finding needs a rank.
    if any("rank" not in f for f in findings):
        print(json.dumps({"error": "findings are unranked — rank is assigned by the synthesizer, not here"}))
        sys.exit(1)
    findings = sorted(findings, key=lambda f: f["rank"])

    base = Image.open(shot_path).convert("RGBA")
    viewport_w = float(viewport.get("width", base.width))

    # 1. Validate locations.
    placed, unplaced = [], []
    for f in findings:
        bbox = resolve_bbox(f, landmarks)
        if bbox is None:
            unplaced.append({"rank": f["rank"], "reason": "no resolvable location"})
        else:
            placed.append((f, bbox))

    # 2 + 3. Anchors, then declutter in rank order.
    anchors = declutter([anchor_point(b, viewport_w) for _, b in placed])
    # Keep every pin fully on-canvas (a top/left-edge element can push it off).
    anchors = [(min(max(cx, PIN_R), base.width - PIN_R),
                min(max(cy, PIN_R), base.height - PIN_R)) for cx, cy in anchors]

    # 4. Draw outlines (alpha overlay) then pins on a copy.
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
                     "severity": f.get("severity", DEFAULT_SEV), "clustered": False})

    # 5. Legend strip along the bottom.
    legend_font = load_font(14)
    legend_h = LEGEND_PAD * 2 + LEGEND_ROW_H * len(placed)
    out = Image.new("RGBA", (canvas.width, canvas.height + legend_h), (255, 255, 255, 255))
    out.paste(canvas, (0, 0))
    ld = ImageDraw.Draw(out)
    ld.line([0, canvas.height, canvas.width, canvas.height], fill=(0, 0, 0, 40), width=1)
    ry = canvas.height + LEGEND_PAD
    for f, _ in placed:
        fill = SEV_COLORS[sev_key(f)][0]
        # pin number chip
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

    out_path = shot_path.with_suffix(".annotated.png")
    out.convert("RGB").save(out_path)

    manifest = {
        "annotated_screenshot_path": str(out_path),
        "original_screenshot_path": str(shot_path),
        "pins": pins,
        "clusters": [],
        "unplaced": unplaced,
    }
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

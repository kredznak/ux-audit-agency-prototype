---
name: page-inspector
description: Inspect a real web page via the Playwright MCP and return one
  structured snapshot for the audit sub-agents. Use when the Lead needs to
  inspect a URL, or when a sub-agent needs targeted page data (accessibility
  tree, a DOM region, console output, a screenshot, or form interaction).
---

## What this skill does

Drives the **Playwright MCP** to inspect a live page and returns a single **structured snapshot**. This is the only sanctioned way to gather page evidence in this project — sub-agents reason over this output rather than guessing about a page they cannot see.

This skill **describes**, it does not **judge**. All evaluation belongs to the sub-agents.

## Procedure

1. **Navigate** — `browser_navigate` to the URL. If the input is a screenshot (no URL), skip Playwright, build the snapshot from the image, and set `source: "screenshot"`.
2. **Settle** — let the page load; record the viewport (`browser_resize` if a specific viewport, e.g. mobile, was requested).
3. **Accessibility tree** — `browser_snapshot` for the structured role/name/state tree. This is the backbone of the snapshot.
4. **Screenshot** — `browser_take_screenshot` (full page).
5. **Console** — `browser_console_messages` for errors and warnings.
6. **Structure** — `browser_evaluate` to extract: headings outline, landmark regions, forms (each field's label, type, required, current validation state, submit control), CTAs/links, and image alt coverage.
7. **Targeted / interactive mode** — when a sub-agent asks for a specific region or interaction (e.g. forms-flow submitting an empty form), run only the relevant steps: `browser_fill_form` / `browser_type` / `browser_click` to act, then re-`browser_snapshot` and re-read console to capture the result.

## Output contract

Return **exactly** this JSON and nothing else:

```json
{
  "url": "https://…",
  "source": "url | screenshot",
  "viewport": { "width": 1280, "height": 800 },
  "title": "…",
  "headings": [ { "level": 1, "text": "…" } ],
  "landmarks": ["header", "nav", "main", "footer"],
  "forms": [
    {
      "name": "…",
      "fields": [
        { "label": "…", "type": "email", "required": true, "hasError": false, "errorText": null }
      ],
      "submit": "Continue"
    }
  ],
  "ctas": [ { "text": "Start free trial", "selector": "a.btn-primary" } ],
  "images": { "total": 12, "missingAlt": 3 },
  "console": { "errors": ["…"], "warnings": ["…"] },
  "screenshotRef": "<path or MCP image handle>",
  "interactions": [ { "action": "submit empty form", "result": "no validation shown" } ],
  "notes": "anything notable, including any inspection step that failed"
}
```

Omit `interactions` for a plain (non-interactive) inspection.

## Rules

- **Real data only.** If a step fails, record it in `notes` and continue — never fabricate a field, error, or console message.
- **Describe, don't analyze.** No severities, no recommendations — that is the sub-agents' job.
- **Requires the `playwright` MCP server** (see `.mcp.json`). If it is unavailable and the input is a URL, report the failure in `notes` so the Lead can fall back to INFERRED, heuristics-only mode.

# Real Audit Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock `synthesize()` findings with real per-agent Claude API calls, expand the roster to 7 agents, and label every finding with its provenance (REAL / INFERRED / FALLBACK).

**Architecture:** Three layers inside the single `index.html`. **Context** (`classify()` + input normalization) produces a shared context. **Reasoning** (spawn rules + 7 per-agent system prompts) decides who analyzes. **Capability** (`runAgents()`) fires one parallel Claude call per spawned agent, stamps each finding's `source`, falls back to the mock `FINDINGS` library on failure, then sorts and renders.

**Tech Stack:** Vanilla HTML/CSS/JS, single file, no build step. Claude API direct-from-browser (`claude-haiku-4-5-20251001`, vision-capable). Tests are DevTools `console.assert` snippets + manual browser verification.

**Spec:** `docs/2026-06-19-real-agents-design.md`

---

## Testing approach (read first)

There is no test runner and a hard no-build constraint. So:

- **Pure functions** (`applyImageGuard`, `sourceFor`, `getFallbackFindings`) are verified by pasting a `console.assert` block into Chrome DevTools after loading `index.html` via `file://`. "Failing test first" = running the snippet before the function exists and seeing `ReferenceError`. "Passing" = the same snippet logging `✓` with no assertion errors.
- **LLM / network / UI / animation** are verified manually in the browser with concrete expected outcomes. A valid Anthropic API key is required for the REAL/INFERRED paths; the FALLBACK path is verifiable offline with a deliberately bad key.
- Top-level `const`/`function` in a non-module `<script>` are reachable by bare name in the DevTools console (e.g. typing `sourceFor` works).

**Reload `index.html` in the browser between every code change** — there is no hot reload.

---

## File structure

All changes are in `index.html`. Its three `<script>` blocks keep their roles:

| Block | Lines (approx) | Role | Changes |
|---|---|---|---|
| Orchestrator | 312–519 | Context + Reasoning + Capability + run loop | config→7, `buildUserContent`, `parseJson`, `applyImageGuard`, `sourceFor`, `AGENT_PROMPTS`, `runOneAgent`, `runAgents`, rewire `runAudit` |
| Findings DB / Renderer | 521–774 | Fallback library + rendering | expand `FINDINGS`, add `getFallbackFindings`, source badge, fallback banner |
| Drop zone | 776–805 | File upload | none |

CSS additions go in the `<style>` block (`.source-tag`, `.fallback-banner`).

---

### Task 1: Expand agent config and classifier to 7 agents

**Files:**
- Modify: `index.html` — `FALLBACK_RESULT` (~317-328), `classify()` system prompt (~350-369), `ALL_AGENTS`/`AGENT_LABELS` (~399-406)

- [ ] **Step 1: Expand `FALLBACK_RESULT.agent_reasons` to 7 keys**

Replace the `agent_reasons` object inside `FALLBACK_RESULT`:

```js
    const FALLBACK_RESULT = {
      page_type: 'unknown',
      agents_to_spawn: ['heuristics'],
      agent_reasons: {
        heuristics:    'always',
        accessibility: 'skipped — classification unavailable',
        visual:        'skipped — classification unavailable',
        forms:         'skipped — classification unavailable',
        copy:          'skipped — classification unavailable',
        conversion:    'skipped — classification unavailable',
        mobile:        'skipped — classification unavailable'
      },
      reasoning: 'Classification unavailable — running heuristics audit only.',
      fallback: true
    };
```

- [ ] **Step 2: Expand the `classify()` system prompt** — replace the `agent_reasons` shape and the rules list:

```js
        system: `You are a UX audit orchestrator. Analyze the given page and return a JSON object only — no prose, no markdown, just the raw JSON.

Return this exact shape:
{
  "page_type": "one of: landing_page | saas_app | checkout_flow | content_page | form_page | other",
  "agents_to_spawn": ["heuristics"],
  "agent_reasons": {
    "heuristics": "always",
    "accessibility": "included — reason OR skipped — reason",
    "visual": "included — reason OR skipped — reason",
    "forms": "included — reason OR skipped — reason",
    "copy": "included — reason OR skipped — reason",
    "conversion": "included — reason OR skipped — reason",
    "mobile": "included — reason OR skipped — reason"
  },
  "reasoning": "one sentence describing the page",
  "looks_mobile": false
}

Rules (follow exactly):
- Always include "heuristics" and "accessibility" in agents_to_spawn
- Include "visual" whenever a screenshot image is provided
- Include "forms" only if page_type is checkout_flow or form_page
- Include "copy" only if page_type is landing_page or content_page
- Include "conversion" only if page_type is landing_page or checkout_flow
- Include "mobile" only if a screenshot is provided AND it looks like a mobile/narrow viewport; also set "looks_mobile" accordingly
- For any agent you do not include, give a one-line "skipped — reason"`,
```

- [ ] **Step 3: Expand `ALL_AGENTS` and `AGENT_LABELS`**

```js
    const ALL_AGENTS = ['heuristics', 'accessibility', 'visual', 'forms', 'copy', 'conversion', 'mobile'];

    const AGENT_LABELS = {
      heuristics:    'Heuristics',
      accessibility: 'Accessibility',
      visual:        'Visual / hierarchy',
      forms:         'Forms / Flow',
      copy:          'Copy',
      conversion:    'Conversion / CTA',
      mobile:        'Mobile / responsive'
    };
```

- [ ] **Step 4: Verify in browser**

Reload `index.html`. In DevTools console run:

```js
console.assert(ALL_AGENTS.length === 7, 'expected 7 agents');
console.assert(Object.keys(AGENT_LABELS).length === 7, 'expected 7 labels');
console.assert(ALL_AGENTS.every(a => AGENT_LABELS[a]), 'every agent has a label');
console.log('✓ Task 1 config');
```

Expected: logs `✓ Task 1 config` with no assertion warnings.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: expand agent config and classifier prompt to 7 agents"
```

---

### Task 2: Add shared `buildUserContent` and `parseJson` helpers

**Files:**
- Modify: `index.html` — inside `classify()` (~330-395), refactor to use the new helpers

- [ ] **Step 1: Add the two helpers** directly above `classify()` (after the `FALLBACK_RESULT` block):

```js
    // Build the user-content payload shared by the classifier and every agent.
    // input is a URL string OR { base64, mediaType }. instruction is the task text.
    function buildUserContent(input, instruction) {
      const isImage = typeof input === 'object' && input.base64;
      if (isImage) {
        return [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.base64 } },
          { type: 'text', text: instruction }
        ];
      }
      return `${instruction}\n\nURL: ${input}`;
    }

    // Parse Claude's text, tolerating ```json fences.
    function parseJson(text) {
      const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(clean);
    }
```

- [ ] **Step 2: Refactor `classify()` to use them** — replace the `userContent` construction and the parse logic. The new `classify()` body:

```js
    async function classify(input, apiKey) {
      const instruction =
        (typeof input === 'object' && input.base64)
          ? 'Classify this UI screenshot as described in the system prompt. Return JSON only.'
          : 'Classify this URL as described in the system prompt. You cannot see the live page — reason from the URL and your knowledge. Return JSON only.';

      const body = {
        model: MODEL,
        max_tokens: 300,
        system: `<<UNCHANGED — keep the system prompt from Task 1 Step 2 exactly as-is>>`,
        messages: [{ role: 'user', content: buildUserContent(input, instruction) }]
      };

      try {
        const res = await fetch(CLAUDE_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const data = await res.json();
        const text = data.content?.[0]?.text ?? '';
        return parseJson(text);
      } catch (err) {
        console.warn('Classification failed, using fallback:', err);
        return FALLBACK_RESULT;
      }
    }
```

> Note: keep the existing `system:` template literal from Task 1 — only the `userContent`/parse lines change. The `<<UNCHANGED>>` marker above is an instruction to you, not literal code.

- [ ] **Step 3: Verify helpers in browser**

Reload. In console:

```js
const img = buildUserContent({ base64: 'AAA', mediaType: 'image/png' }, 'go');
console.assert(Array.isArray(img) && img[0].type === 'image', 'image → content array');
const url = buildUserContent('https://x.com', 'go');
console.assert(typeof url === 'string' && url.includes('https://x.com'), 'url → text');
console.assert(parseJson('```json\n{"a":1}\n```').a === 1, 'parseJson strips fences');
console.log('✓ Task 2 helpers');
```

Expected: `✓ Task 2 helpers`, no warnings.

- [ ] **Step 4: Verify classify still works (manual, needs API key)**

Reload, enter your API key, paste a URL (e.g. `https://stripe.com`), click Run audit. Expected: orchestrator status shows a page type and 7 agent rows (some skipped). No console errors from `classify`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "refactor: extract buildUserContent and parseJson helpers"
```

---

### Task 3: Add pure helpers `applyImageGuard` and `sourceFor`

**Files:**
- Modify: `index.html` — add below `AGENT_LABELS` (~406)

- [ ] **Step 1: Confirm the test fails first**

Reload current `index.html`. In console run the Step 3 snippet below. Expected: `Uncaught ReferenceError: applyImageGuard is not defined`.

- [ ] **Step 2: Add both functions**

```js
    // Visual and Mobile require an actual image. On URL-only input, drop them.
    function applyImageGuard(agents, hasImage) {
      if (hasImage) return agents.slice();
      return agents.filter(a => a !== 'visual' && a !== 'mobile');
    }

    // Provenance of a finding, decided by the execution path (not the agent).
    function sourceFor(hasImage, ok) {
      if (!ok) return 'fallback';
      return hasImage ? 'real' : 'inferred';
    }
```

- [ ] **Step 3: Verify (paste into console after reload)**

```js
console.assert(JSON.stringify(applyImageGuard(['heuristics','visual','mobile'], false)) === '["heuristics"]', 'guard drops visual+mobile on url');
console.assert(applyImageGuard(['heuristics','visual'], true).length === 2, 'guard keeps all with image');
console.assert(sourceFor(true, true) === 'real', 'image+ok → real');
console.assert(sourceFor(false, true) === 'inferred', 'url+ok → inferred');
console.assert(sourceFor(true, false) === 'fallback', 'fail → fallback');
console.assert(sourceFor(false, false) === 'fallback', 'fail → fallback');
console.log('✓ Task 3 pure helpers');
```

Expected: `✓ Task 3 pure helpers`, no assertion warnings.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add applyImageGuard and sourceFor provenance helpers"
```

---

### Task 4: Add the 7 per-agent system prompts

**Files:**
- Modify: `index.html` — add below `sourceFor` (~end of orchestrator config)

- [ ] **Step 1: Add the shared output contract**

```js
    const FINDING_CONTRACT = `

Return ONLY raw JSON — no prose, no markdown fences — in this exact shape:
{
  "findings": [
    {
      "category": "short label for the issue type",
      "severity": "critical | major | minor",
      "title": "one-line problem statement",
      "description": "2-3 sentences on the problem and its user impact",
      "location": "where on the page this occurs",
      "fix": "specific, actionable remedy"
    }
  ]
}
Rules:
- Return 2 to 5 findings, most severe first.
- "severity" MUST be exactly one of: critical, major, minor.
- If you genuinely find no issues, return {"findings": []}.
- If you are reasoning from a URL without seeing the live page, base findings on common patterns for this kind of page and stay appropriately cautious.`;
```

- [ ] **Step 2: Add `AGENT_PROMPTS`**

```js
    const AGENT_PROMPTS = {
      heuristics: `You are a UX heuristics auditor. Evaluate the page against Nielsen's 10 usability heuristics — visibility of system status, match to the real world, user control, consistency, error prevention, recognition over recall, flexibility, minimalist design, error recovery, and help. Identify concrete usability violations.` + FINDING_CONTRACT,
      accessibility: `You are an accessibility auditor. Evaluate the page against WCAG 2.1 AA. From a screenshot, judge color contrast, text size, touch-target size, and visible labels/focus affordances. Flag likely violations with the relevant WCAG criterion in "category".` + FINDING_CONTRACT,
      visual: `You are a visual design auditor. Evaluate visual hierarchy, spacing and alignment, typographic scale, contrast and color use, whitespace, grid consistency, and the visual weight of primary actions. Flag where the design fights the user's eye.` + FINDING_CONTRACT,
      forms: `You are a forms and flow auditor. Evaluate form length, field labeling, input types, inline validation, error states, progress indication, and friction in the completion flow. Flag anything that raises abandonment.` + FINDING_CONTRACT,
      copy: `You are a UX copy auditor. Evaluate headline clarity, jargon, value-proposition strength, scannability, microcopy, and CTA verb specificity. Flag copy that is vague, product-centric instead of user-centric, or unclear.` + FINDING_CONTRACT,
      conversion: `You are a conversion auditor. Evaluate the prominence and clarity of the primary action, presence of trust signals and social proof, risk-reversal, and friction between the user and conversion. Flag anything that suppresses conversion.` + FINDING_CONTRACT,
      mobile: `You are a mobile/responsive auditor. Evaluate touch-target size, thumb reachability, tap spacing, viewport fit, and content density on small screens. Flag mobile-specific usability problems.` + FINDING_CONTRACT
    };
```

- [ ] **Step 3: Verify (console after reload)**

```js
console.assert(Object.keys(AGENT_PROMPTS).length === 7, '7 prompts');
console.assert(ALL_AGENTS.every(a => typeof AGENT_PROMPTS[a] === 'string' && AGENT_PROMPTS[a].includes('findings')), 'each prompt defined + has contract');
console.log('✓ Task 4 prompts');
```

Expected: `✓ Task 4 prompts`, no warnings.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add per-agent system prompts and shared finding contract"
```

---

### Task 5: Expand fallback `FINDINGS` library and add `getFallbackFindings`

**Files:**
- Modify: `index.html` — `FINDINGS` object (~523-688), add `getFallbackFindings` near `synthesize` (~693)

- [ ] **Step 1: Add `visual`, `conversion`, and `mobile` arrays to `FINDINGS`**

Insert these three keys into the `FINDINGS` object (e.g. after the existing `copy` array, before the closing `}`):

```js
      visual: [
        {
          agent: 'visual',
          category: 'Visual hierarchy',
          severity: 'major',
          title: 'Primary CTA has the same visual weight as secondary actions',
          description: 'The main action does not stand out — it shares color, size, and weight with secondary links, so the eye has no clear entry point.',
          location: 'Hero section — action row',
          fix: 'Give the primary CTA a high-contrast solid fill and demote secondary actions to outlined or text styles.'
        },
        {
          agent: 'visual',
          category: 'Spacing & rhythm',
          severity: 'minor',
          title: 'Inconsistent vertical spacing between sections',
          description: 'Section gaps vary without a clear pattern, making the page feel unstructured and harder to scan.',
          location: 'Between content sections',
          fix: 'Adopt a consistent spacing scale (e.g. 8px base) and apply the same section gap throughout.'
        }
      ],

      conversion: [
        {
          agent: 'conversion',
          category: 'Trust signals',
          severity: 'major',
          title: 'No social proof near the primary conversion point',
          description: 'There are no testimonials, logos, ratings, or usage numbers near the CTA, so hesitant visitors have nothing to reduce perceived risk.',
          location: 'Above and around the primary CTA',
          fix: 'Add a row of customer logos, a star rating, or a short testimonial directly adjacent to the primary action.'
        },
        {
          agent: 'conversion',
          category: 'Risk reversal',
          severity: 'minor',
          title: 'Primary CTA lacks reassurance microcopy',
          description: 'The action button gives no sense of commitment level — users do not know if they will be charged or can back out.',
          location: 'Primary CTA',
          fix: 'Add reassurance under the button: "No credit card required" or "Cancel anytime".'
        }
      ],

      mobile: [
        {
          agent: 'mobile',
          category: 'Touch targets',
          severity: 'major',
          title: 'Tap targets smaller than 44×44px',
          description: 'Several interactive elements are below the recommended minimum touch size, making them hard to hit accurately on a phone.',
          location: 'Navigation and inline links',
          fix: 'Increase interactive elements to at least 44×44px and add padding around small links.'
        },
        {
          agent: 'mobile',
          category: 'Thumb reach',
          severity: 'minor',
          title: 'Primary action sits in the hard-to-reach top zone',
          description: 'The main CTA is near the top of the viewport, outside the comfortable thumb zone for one-handed use.',
          location: 'Top of mobile viewport',
          fix: 'Consider a sticky bottom action bar for the primary CTA on small screens.'
        }
      ]
```

- [ ] **Step 2: Add `getFallbackFindings`** next to `synthesize` (keep `synthesize` for now; it is removed in Task 7):

```js
    // Returns the mock findings for one agent (used when its live call fails).
    function getFallbackFindings(agent) {
      return (FINDINGS[agent] || []).map(f => ({ ...f }));
    }
```

- [ ] **Step 3: Verify (console after reload)**

```js
console.assert(Object.keys(FINDINGS).length === 7, 'FINDINGS has 7 agents');
['visual','conversion','mobile'].forEach(a =>
  console.assert(getFallbackFindings(a).length > 0, a + ' fallback present'));
console.assert(getFallbackFindings('nope').length === 0, 'unknown agent → empty');
console.log('✓ Task 5 fallback library');
```

Expected: `✓ Task 5 fallback library`, no warnings.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add visual/conversion/mobile fallback findings and getFallbackFindings"
```

---

### Task 6: Add `runOneAgent` and `runAgents` (the Capability layer)

**Files:**
- Modify: `index.html` — add in the orchestrator block, after `classify()` (~396)

- [ ] **Step 1: Add `runOneAgent`** (one Claude call for one agent; throws on failure):

```js
    async function runOneAgent(agent, input, apiKey) {
      const instruction =
        (typeof input === 'object' && input.base64)
          ? 'Analyze this screenshot per the system prompt. Return JSON only.'
          : 'Analyze this page per the system prompt. You cannot see the live page — reason from the URL and your knowledge. Return JSON only.';

      const body = {
        model: MODEL,
        max_tokens: 800,
        system: AGENT_PROMPTS[agent],
        messages: [{ role: 'user', content: buildUserContent(input, instruction) }]
      };

      const res = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Agent ${agent} API error ${res.status}`);
      const data = await res.json();
      const text = data.content?.[0]?.text ?? '';
      const parsed = parseJson(text);
      return Array.isArray(parsed.findings) ? parsed.findings : [];
    }
```

- [ ] **Step 2: Add `runAgents`** (parallel fan-out, source stamping, per-agent fallback, sort):

```js
    async function runAgents(agents, input, apiKey) {
      const hasImage = typeof input === 'object' && !!input.base64;

      const perAgent = await Promise.all(agents.map(async agent => {
        try {
          const findings = await runOneAgent(agent, input, apiKey);
          const source = sourceFor(hasImage, true);
          return findings.map(f => ({ ...f, agent, source }));
        } catch (err) {
          console.warn(`Agent ${agent} failed, using fallback:`, err);
          const source = sourceFor(hasImage, false); // 'fallback'
          return getFallbackFindings(agent).map(f => ({ ...f, agent, source }));
        }
      }));

      return perAgent
        .flat()
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    }
```

> `SEVERITY_ORDER` lives in the findings-DB script block, which loads before any audit runs, so it is available at call time.

- [ ] **Step 3: Verify the fallback path offline (console after reload)**

This uses a deliberately bad key so every call fails → every finding is `fallback`:

```js
runAgents(['heuristics','visual'], { base64: 'AAA', mediaType: 'image/png' }, 'bad-key')
  .then(fs => {
    console.assert(fs.length > 0, 'fallback produced findings');
    console.assert(fs.every(f => f.source === 'fallback'), 'all fallback on failure');
    console.assert(fs.every(f => f.agent && f.severity), 'agent + severity stamped');
    const ord = { critical:0, major:1, minor:2 };
    console.assert(fs.every((f,i,a)=> i===0 || ord[a[i-1].severity] <= ord[f.severity]), 'sorted by severity');
    console.log('✓ Task 6 runAgents fallback path');
  });
```

Expected (after console warnings about failed agents): `✓ Task 6 runAgents fallback path`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add runOneAgent and runAgents parallel capability layer"
```

---

### Task 7: Rewire `runAudit` to use the image guard and `runAgents`

**Files:**
- Modify: `index.html` — `runAudit()` (~470-516); delete `synthesize` (~693-696)

- [ ] **Step 1: Replace the post-classify section of `runAudit`**

Find this block in `runAudit`:

```js
      // Real Claude call
      const result = await classify(input, apiKey);

      if (result.fallback) {
        document.getElementById('pageTypeLabel').textContent = 'Classification unavailable';
      }

      // Reveal agents sequentially
      await revealAgents(result);

      // Synthesize + reveal findings
      const findings = synthesize(result.agents_to_spawn);
      await revealFindings(findings);
```

Replace it with:

```js
      // Context layer: classify the page
      const result = await classify(input, apiKey);

      if (result.fallback) {
        document.getElementById('pageTypeLabel').textContent = 'Classification unavailable';
      }

      // Reasoning layer: drop image-only agents when there is no screenshot
      const hasImage = typeof input === 'object' && !!input.base64;
      const guarded = applyImageGuard(result.agents_to_spawn, hasImage);
      ['visual', 'mobile'].forEach(a => {
        if (result.agents_to_spawn.includes(a) && !guarded.includes(a)) {
          result.agent_reasons[a] = 'skipped — no screenshot, visual inspection unavailable';
        }
      });
      result.agents_to_spawn = guarded;

      // Capability layer: kick off real agent calls, overlap with the reveal animation
      const findingsPromise = runAgents(result.agents_to_spawn, input, apiKey);
      await revealAgents(result);
      const findings = await findingsPromise;
      await revealFindings(findings);
```

- [ ] **Step 2: Delete the now-unused `synthesize`**

Remove this block from the findings-DB script (leave `SEVERITY_ORDER` — `runAgents` uses it):

```js
    function synthesize(agentsToSpawn) {
      const findings = agentsToSpawn.flatMap(agent => FINDINGS[agent] || []);
      return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    }
```

- [ ] **Step 3: Verify no dangling references**

In the project shell:

```bash
grep -n "synthesize" index.html
```

Expected: no output (no remaining references).

- [ ] **Step 4: Verify end-to-end with a screenshot (manual, needs API key)**

Reload, enter API key, upload a screenshot of any web page, Run audit. Expected: agents animate in; after a few seconds real findings appear, each tagged (badge styling lands in Task 8 — for now confirm findings render and the run completes without console errors). The timing badge shows elapsed seconds.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: wire runAudit through image guard and runAgents, remove synthesize"
```

---

### Task 8: Render the provenance badge on each finding

**Files:**
- Modify: `index.html` — `<style>` block (near `.finding-category` ~227), `findingHtml()` (~712-724)

- [ ] **Step 1: Add badge CSS** (after the `.finding-category` rule):

```css
    .source-tag {
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--gray-400);
      margin-left: auto;
    }
    .source-tag.fallback {
      color: var(--gray-500);
      border: 1px solid var(--gray-300);
      border-radius: 3px;
      padding: 1px 4px;
      margin-left: auto;
    }
```

- [ ] **Step 2: Add the badge to `findingHtml`** — update the `finding-meta` row:

```js
    function findingHtml(f) {
      return `
        <div class="finding-meta">
          <div class="severity-dot ${f.severity}"></div>
          <span class="severity-label ${f.severity}">${f.severity}</span>
          <span class="finding-category">${escapeHtml(f.agent)} · ${escapeHtml(f.category)}</span>
          <span class="source-tag ${f.source}">${escapeHtml(f.source || '')}</span>
        </div>
        <div class="finding-title">${escapeHtml(f.title)}</div>
        <div class="finding-description">${escapeHtml(f.description)}</div>
        <div class="finding-location">Location: ${escapeHtml(f.location)}</div>
        <div class="finding-fix">Fix: ${escapeHtml(f.fix)}</div>
      `;
    }
```

- [ ] **Step 3: Verify the three badge states (manual)**

Reload. Three checks:
1. **REAL** — run an audit with a screenshot + valid key → badges read `REAL`.
2. **INFERRED** — run an audit with a URL + valid key → badges read `INFERRED`.
3. **FALLBACK** — run an audit with a screenshot + a **bad** key typed in the key field → agents fail → badges read `FALLBACK` with a thin border.

Expected: badge text and style match the source in every case.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: show REAL/INFERRED/FALLBACK provenance badge on findings"
```

---

### Task 9: Add the fallback banner

**Files:**
- Modify: `index.html` — `<style>` block, `renderFindings()` (~726-753)

- [ ] **Step 1: Add banner CSS** (after the `.source-tag` rules):

```css
    .fallback-banner {
      font-size: 11px;
      color: var(--gray-500);
      border: 1px solid var(--gray-300);
      border-radius: 4px;
      padding: 6px 10px;
      margin-bottom: 12px;
    }
```

- [ ] **Step 2: Build and insert the banner in `renderFindings`** — at the top of the function, after `const rest = findings.slice(VISIBLE);`, compute the banner; then inject it right after the `findings-header` div:

```js
      const fallbackAgents = [...new Set(
        findings.filter(f => f.source === 'fallback').map(f => f.agent)
      )];
      const bannerHtml = fallbackAgents.length
        ? `<div class="fallback-banner">Some findings are sample data — ${fallbackAgents.length} agent${fallbackAgents.length > 1 ? 's' : ''} couldn't complete.</div>`
        : '';
```

Then update the `html` assignment to include `${bannerHtml}` immediately after the closing `</div>` of `findings-header`:

```js
      let html = `
        <div class="findings-header">
          <div class="section-label">
            Findings <span class="findings-count">${findings.length} total</span>
          </div>
          <div class="findings-sort-label">sorted by severity</div>
        </div>
        ${bannerHtml}
      `;
```

- [ ] **Step 3: Verify (manual)**

Reload. Run an audit with a **bad** key (forces fallback). Expected: a bordered banner reads "Some findings are sample data — N agents couldn't complete." Run again with a **valid** key + screenshot. Expected: no banner.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add sample-data banner when any agent falls back"
```

---

### Task 10: Full end-to-end verification and docs update

**Files:**
- Modify: `CLAUDE.md` — "How it works" / "Key technical details" to reflect real per-agent analysis

- [ ] **Step 1: Run the three provenance scenarios end-to-end** (needs a valid API key)

1. **Screenshot → REAL:** upload a screenshot, valid key, Run audit. Expect 7-row orchestrator (visual/mobile may be included), real findings, `REAL` badges, no banner, timing badge populated.
2. **URL → INFERRED:** paste `https://stripe.com`, valid key, Run audit. Expect visual + mobile rows show "skipped — no screenshot…", findings tagged `INFERRED`.
3. **Bad key → FALLBACK:** type `bad-key`, upload a screenshot, Run audit. Expect findings tagged `FALLBACK` and the sample-data banner.

Confirm no uncaught errors in the console for any scenario.

- [ ] **Step 2: Update `CLAUDE.md`** — replace the mock-data description. Change the "How it works" paragraph to note that each spawned agent makes its own Claude call returning real findings (screenshots) or inferred findings (URLs), and update the agents list to the 7-agent roster. Replace the line "Findings are pre-written mock data, not real analysis" with: "Each agent makes a real Claude call; findings are labeled REAL (screenshot), INFERRED (URL), or FALLBACK (mock data, used when an agent call fails)."

- [ ] **Step 3: Commit**

```bash
git add index.html CLAUDE.md
git commit -m "docs: update CLAUDE.md for real per-agent analysis; verify end-to-end"
```

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Self-review

**Spec coverage:**
- Screenshots→real / URLs→inferred — Tasks 2, 6, 7 (`buildUserContent`, `sourceFor`, image guard). ✓
- Per-agent parallel calls — Task 6 (`runAgents` + `Promise.all`). ✓
- 7-agent roster + spawn rules — Tasks 1, 4; image-only guard in Task 7. ✓
- Finding contract with `source` field — Tasks 4, 6. ✓
- REAL/INFERRED/FALLBACK labels + rendering — Tasks 6, 8. ✓
- Resilience (classify fallback, per-agent fallback) — Task 2 (existing), Tasks 5, 6. ✓
- Fallback banner — Task 9. ✓
- Mock `FINDINGS` becomes fallback library — Tasks 5, 7. ✓
- Out-of-scope items — untouched. ✓

**Placeholder scan:** The only `<<…>>` marker (Task 2 Step 2) is an explicit "keep existing code" instruction, not a code placeholder, and is called out as such. No TBD/TODO.

**Type consistency:** `runAgents(agents, input, apiKey)`, `runOneAgent(agent, input, apiKey)`, `sourceFor(hasImage, ok)`, `applyImageGuard(agents, hasImage)`, `getFallbackFindings(agent)`, `buildUserContent(input, instruction)`, `parseJson(text)` are used consistently across tasks. Finding objects carry `{agent, category, severity, title, description, location, fix, source}` everywhere. `SEVERITY_ORDER` is reused, not redefined.

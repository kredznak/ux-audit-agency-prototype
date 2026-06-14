# User Stories: UX Audit Agency

---

**Story 1:** As a solo founder or builder, I want to submit a URL or upload screenshots and receive a prioritized list of UX issues so that I can fix real problems in my interface without needing a designer or UX specialist.

**Acceptance Criteria:**
- Given I land on the tool, when I paste a public URL and submit, then the system begins auditing within 3 seconds and returns a structured report in under 120 seconds
- Given I have no live URL, when I upload one or more screenshots, then the system accepts them and produces findings scoped to each uploaded screen
- Given the audit completes, when I view the report, then issues are ranked by severity (critical → major → minor) with the top 5 surfaced first
- Given any finding in the report, when I read it, then it includes: the location on the page, the severity level, and a concrete suggested fix — never prose-only

**Priority:** Must-have
**Effort:** Large (1 week+)

---

**Story 2:** As a user, I want the system to automatically detect what kind of page I submitted and spawn the right analysis agents so that I receive relevant findings rather than a generic checklist.

**Acceptance Criteria:**
- Given a URL or screenshots are submitted, when the orchestrator inspects the input, then it always spawns the heuristics agent and synthesizer
- Given the page contains a form, checkout, or multi-step flow, when the orchestrator detects this, then it also spawns the form/flow agent
- Given the page DOM is available (URL input), when the orchestrator inspects it, then it spawns the accessibility agent
- Given the orchestrator has decided which agents to run, when agents execute, then they run in parallel — not sequentially

**Priority:** Must-have
**Effort:** Large (1 week+)

---

**Story 3:** As a user, I want the heuristics agent to evaluate my page against Nielsen's 10 usability heuristics so that I get expert-grounded feedback even without a UX background.

**Acceptance Criteria:**
- Given the heuristics agent analyzes a page, when findings are returned, then each finding names the specific heuristic violated (by name and number, e.g. "H4: Consistency and Standards")
- Given a finding is returned, when I read it, then it includes the location on the page, a severity rating, evidence (what specifically was observed), and a suggested fix
- Given the page has no heuristic violations, when the agent completes, then it returns a clean result rather than fabricating issues

**Priority:** Must-have
**Effort:** Medium (2-3 days)

---

**Story 4:** As a user, I want the synthesizer to deduplicate and reconcile findings from all agents so that I see a clean, unified report rather than overlapping or conflicting issues.

**Acceptance Criteria:**
- Given multiple agents return findings, when the synthesizer runs, then no single issue appears more than once in the final output
- Given two agents flag the same issue with different severity ratings, when the synthesizer resolves the conflict, then it keeps the higher severity
- Given the synthesizer completes, when the report is rendered, then the final output is ordered by severity score and the top 5 issues are immediately actionable without reading the full report

**Priority:** Must-have
**Effort:** Medium (2-3 days)

---

**Story 5:** As a user on a public site, I want an accessibility agent to evaluate contrast ratios, tab order, alt text, and focus states so that I catch WCAG failures before users with disabilities encounter them.

**Acceptance Criteria:**
- Given a URL is submitted (DOM available), when the accessibility agent runs, then it checks: color contrast ratios, keyboard tab order, presence of alt text on images, and visible focus states
- Given an accessibility issue is found, when the finding is returned, then it cites the specific WCAG criterion violated and describes the fix
- Given screenshot-only input (no DOM), when the accessibility agent is invoked, then it runs a limited visual-only check and clearly flags which checks were skipped due to missing DOM data

**Priority:** Should-have
**Effort:** Medium (2-3 days)

---

**Story 6:** As a user with a form or checkout on my page, I want a form/flow agent to identify friction points so that I can reduce abandonment in my most critical conversion path.

**Acceptance Criteria:**
- Given the orchestrator detects a form or multi-step flow, when the form/flow agent runs, then it checks for: missing or ambiguous field labels, unclear error states, excessive required fields, and confusing CTA copy
- Given a friction point is found, when the finding is returned, then it names the specific field or step affected, rates the severity, and suggests a fix
- Given a page with no form or checkout, when the orchestrator evaluates it, then the form/flow agent is not spawned

**Priority:** Should-have
**Effort:** Medium (2-3 days)

---

**Story 7:** As a user, I want to receive a shareable HTML report at the end of my audit so that I can send findings to a collaborator, developer, or client without them needing access to the tool.

**Acceptance Criteria:**
- Given an audit completes, when I click "Download Report," then a self-contained HTML file is generated and saved to my device
- Given the HTML report is opened in a browser, when I view it, then it displays all findings grouped by severity, with location, evidence, and fix for each
- Given I share the HTML file with someone, when they open it, then it renders correctly without requiring any login or tool access

**Priority:** Nice-to-have
**Effort:** Medium (2-3 days)

---

**Story 8:** As a returning user, I want to re-audit a page after making changes and see a diff of what improved and what's still outstanding so that I can confirm my fixes worked and track progress over time.

**Acceptance Criteria:**
- Given I previously audited a URL, when I submit it again and choose "Compare to last audit," then the report highlights: resolved issues, new issues, and unchanged issues
- Given the diff view is displayed, when I read it, then resolved issues are visually distinct from new and unchanged ones
- Given no previous audit exists for the URL, when I submit it, then the system runs a fresh audit with no diff UI shown

**Priority:** Nice-to-have `[NEEDS CLARIFICATION — depends on whether audit history is stored]`
**Effort:** Large (1 week+)

---

## Edge Cases to Discuss

- **Single-page apps (SPAs):** Pages built in React/Vue may not be fully rendered when scraped via a simple URL fetch — a headless browser is likely required, but what's the fallback if it times out or fails?
- **Screenshot quality:** A blurry, cropped, or low-resolution screenshot may prevent the vision model from detecting issues reliably — should we validate image quality on upload and prompt the user to re-submit?
- **Auth-walled pages:** A user may paste a URL that requires login — the tool will silently audit the login page or a redirect instead of their intended page. Should we detect and warn them?
- **Very long or scroll-heavy pages:** A URL audit captures a viewport; a page with 10 screens of content may produce incomplete findings. Should the orchestrator take multiple scroll-position screenshots automatically?
- **Multiple findings for the same element:** Three agents could all flag the same button for different reasons — the synthesizer deduplication logic needs to match by location, not just issue text, or it'll miss these.
- **Empty or minimal pages:** A page under construction or a 404 might produce meaningless findings — the system should detect low-content pages and return a "not enough to audit" message rather than fabricated issues.

---

## Questions for the Team

1. Does the orchestrator use LLM classification to detect page type (form-heavy, content page, SaaS app) or rule-based DOM inspection — and what's the fallback when it misclassifies?
2. Is audit history stored server-side (enabling the diff/re-audit feature) or is this tool stateless per session — this decision gates Story 8 entirely and affects data retention policy?
3. For screenshot inputs without DOM access, which agents are silently skipped versus which ones run in degraded mode and flag the limitation — and does the user see this clearly?
4. Who owns the test set for measuring routing accuracy and coverage — and is it built before or after the first working version?
5. What's the plan if parallel agent calls push total time over 120 seconds — is there a timeout per agent, a graceful partial result, or a hard failure?

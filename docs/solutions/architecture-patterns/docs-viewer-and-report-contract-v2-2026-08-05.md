---
title: In-app docs viewer and the landed-change report contract-v2 split
date: 2026-08-05
last_updated: 2026-08-11
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: tooling
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "Adding or changing a docs/solutions or docs/reports route under packages/athena-webapp/src/routes/docs*"
  - "Authoring or rendering a landed-change report via .agents/skills/ce-landed-change-report"
  - "Editing render_report.py, report-presentation-check.ts, or landed-change-report-check.ts"
  - "Classifying production deploy impact for changes under docs/solutions or docs/reports"
tags:
  [
    docs-viewer,
    landed-change-report,
    vite-virtual-module,
    report-contract,
    delivery-gate,
  ]
delivery_diff_fingerprint: d6dd08c7571e5d0fa2ef5b63ddf359c0c5ea443c0692671c82f30f14e372461d
---

# In-app docs viewer and the landed-change report contract-v2 split

## Problem

`docs/solutions/**/*.md` and `docs/reports/**/*.html` only existed as raw files in
the repo — no in-app way to browse them, and landed-change reports were
standalone HTML pages with embedded CSS/JS/forms authored ad hoc by whichever
agent generated them, so every report looked different and the webapp could
only show them in a sandboxed iframe.

## Solution

Two changes, delivered together because the second depends on the first:

**1. In-app docs viewer.** `packages/athena-webapp/vite-docs-content-plugin.ts`
indexes `docs/solutions/**/*.md` and `docs/reports/**/*.html` at build/dev
time into a virtual module (`virtual:athena-docs-index`) that carries
metadata only — titles, dates, categories, slugs. Document bodies lazy-load
per page via `import.meta.glob`, so the index stays cheap even as the corpus
grows. New routes (`docs.tsx`, `docs.index.tsx`, `docs.solutions.*.tsx`,
`docs.reports.*.tsx`) render that content publicly. The `security-issues`
solution category is the exception: public listings omit its metadata, direct
category and document navigation redirects signed-out readers to login, and
its document body does not lazy-load until `useAuth` resolves an Athena user.
This is an application access boundary, not a place to store secrets: the docs
corpus is still compiled into browser assets and needs a server-authorized
content endpoint before it can provide confidentiality against direct asset
discovery.

That build-time ownership also defines deployment scope: a change under
`docs/solutions/**` or `docs/reports/**` changes the Athena webapp bundle even
when every other changed file is harness-only. After merge, deploy the clean
root checkout with `scripts/deploy-vps.sh athena-local`; otherwise QA will show
the new corpus while production continues serving the previous static bundle.

The public docs shell emits one `athena_webapp.workspace_viewed` context event
per browser-tab session and authentication state. The server derives an
`athenaUser` actor for signed-in readers; signed-out readers use a random,
tab-scoped guest id. The event records only the fixed `/docs` route, the
`docs` workspace code, a coarse viewport bucket, and the session reference —
never email, query parameters, referrer, document title, or document body.
Because docs have no store context, this one registered event may omit
`storeId`; the append boundary rejects every other unscoped context event and
marks docs visits non-compilable so they cannot become store/customer
intelligence evidence.

**2. Report contract v2.** Landed-change reports move from freeform styled
HTML (v1) to semantic content documents: a single
`<article data-athena-landed-change-report="v2">` root with no inline CSS,
`<script>`, or form controls — see
`.agents/skills/ce-landed-change-report/references/report-html-contract.md`.
The webapp owns all presentation and hydrates the quiz itself
(`src/lib/docs/reportContract.ts` parses and re-sanitizes the DOM;
`DocsReportQuiz.tsx` grades it). `render_report.py` was rewritten to emit
this shape from the existing JSON payload contract, so the report-authoring
workflow itself is unchanged — only what comes out of the renderer changed.

All ~65 pre-existing reports were migrated in place by
`scripts/migrate-reports-to-v2.mjs`, a deterministic DOM-based converter that
moves existing prose nodes rather than retyping them, preserving wording
byte-for-byte. Five distinct legacy quiz/answer-key dialects were discovered
empirically during migration (lettered vs 0-based vs 1-based answers,
`div.wrap` vs `<section>` wrappers, two shapes of JS-embedded answer arrays,
and one report with no answer key at all — handled with an explicit,
auditable override rather than fabricating one).

Enforcement is deliberately split in two:

- `bun run reports:presentation:check` runs over the **whole corpus**, every
  time: root marker, no styling/scripting, header/pills, section ordering,
  kebab-case keys, well-formed quiz.
- `bun run landed-report:check` additionally requires the full narrative
  section vocabulary, key-files table, subagent evidence, and a five-question
  quiz — but only for reports **authored or changed on the current branch**.
  Requiring the full vocabulary retroactively on every historical report
  would mean fabricating sections they never had.

## Why This Matters

Bulk-migrating 65 files with agent subagents first hit a monthly spend limit
after only 9 conversions — the deterministic script exists because
agent-per-file migration doesn't scale and can't guarantee verbatim text
preservation. Splitting presentation enforcement (corpus-wide) from
narrative-completeness enforcement (branch-scoped) avoids a false choice
between "rewrite history" and "let new work skip requirements old work never
had."

A malformed or non-v2 report is not a hard failure at read time:
`parseReportDocument` returns `null` when the v2 root marker is missing, and
`DocsReportView` falls back to a sandboxed `<iframe sandbox="allow-scripts">`
— isolated from the app shell, but still executing the file's own embedded
script if the sensor is ever bypassed. The presentation check is what should
make that path unreachable in practice.

## Prevention

- Keep `bun run reports:presentation:check` wired into `pr:athena:validate-provider`
  so a report that regresses the v2 contract fails delivery before merge, not
  after a reader hits the iframe fallback.
- When adding a new `docs/reports/*.html` file by hand (not via
  `render_report.py`), follow
  `.agents/skills/ce-landed-change-report/references/report-html-contract.md`
  exactly — no `<style>`/`<script>`/`<img>`/`<form>`, one `<h2>` per section,
  `quiz` and `subagent-evidence` last.
- Regenerate `data-athena-report-diff-fingerprint` via
  `bun scripts/landed-change-report-check.ts --base origin/main --print-fingerprint`
  after the final code/workflow edit on a branch, not before — a fingerprint
  computed earlier goes stale the moment later edits land.
- If a new `docs/*` surface is added under `packages/athena-webapp/src/routes/`,
  add its build-pipeline file (e.g. a new vite plugin) to the "Route runtime
  or build-pipeline edits" harness validation scenario in
  `scripts/harness-app-registry.ts`, or the harness contract preflight will
  flag it as an uncovered surface.
- Keep `AGENTS.md` and
  `scripts/pr-athena-guidance-contract.test.ts` explicit that
  `docs/solutions/**` and `docs/reports/**` require the Athena static-app
  production deploy. File location alone is not a safe deployment classifier
  when a build imports content from outside its package directory.
- Give the real harness-audit fixture tests enough time to run both failure and
  repaired subprocesses. Their contract is the observed result, not Vitest's
  five-second default; as the registry grows, that default can turn a healthy
  audit into a merge-gate timeout.
- Run `bun install` with the bun version pinned in `package.json`'s
  `packageManager` field, not whatever bun happens to be on `PATH`. This
  branch hit CI failure `error parsing lockfile: Outdated lockfile version`
  because a newer local bun (1.3.12) rewrote `bun.lockb` into a format the
  CI-pinned bun (1.1.29) can't read — the gate passed locally and failed only
  in CI. `bun run bun-version:check` (wired into `pr:athena:prepare` as of
  this branch) now fails fast locally with the same drift, before the gate
  runs, instead of surfacing as a CI-only failure after push.

## Examples

Rendering a new report from a JSON payload (see
`.agents/skills/ce-landed-change-report/references/report-payload.md` for the
full field contract):

```bash
python3 .agents/skills/ce-landed-change-report/scripts/render_report.py \
  input.json docs/reports/2026-08-05-my-change-report.html
bun run reports:presentation:check
```

## Related

- [[athena-delivery-gate]] (auto memory) — the `pr:athena` gate that requires
  this note and a landed-change report for branches over the size thresholds.
- `docs/solutions/harness/landed-change-report-gate-2026-07-09.md` — the
  original sensor that first required a landed-change report for large
  branches; this note documents the v2 presentation split layered on top of
  it.

---
title: The Sensor Ladder — What A Green Vitest Suite Cannot See
date: 2026-08-22
category: harness
module: athena-webapp
problem_type: sensor_blind_spot
component: testing-sensors
symptoms:
  - "`bun run test` is 100% green while `bunx convex dev --once` reports `No matching export in ... for import`"
  - "The suite passes while `tsc --noEmit` reports real errors at `internal.*` call sites and on wrong `expectTypeOf` expectations"
  - "eslint reports findings on a unit that touched no UI files, because the frontend config also covers `shared/**`"
  - "A jsdom test proves a renderer emits no anchor, but cannot prove the page issues no network request"
resolution_type: ordered_sensor_run_before_done
severity: high
tags:
  - testing
  - vitest
  - typecheck
  - eslint
  - convex-test
  - playwright
  - agent-harness
delivery_diff_fingerprint: f7a916eb8ed76e225542537afdaf1718be485212def2aef000518425a513d72c
---

# The Sensor Ladder — What A Green Vitest Suite Cannot See

## Problem

Across ten agent-harness units, every real defect that escaped the unit's own
tests was found by **the sensor nobody had run yet** — not by a better test at
the same rung. A green Vitest run was, repeatedly, compatible with a module that
would not bundle, would not typecheck, would not lint, and would not behave the
same way in a real browser engine.

Each sensor has a specific blind spot. This note states, rung by rung, what each
one alone cannot prove, with the verbatim failure that exposed it.

Deploy-side constraints found this way are catalogued separately in [Convex deploy
and module-graph constraints](./convex-deploy-and-module-graph-constraints-2026-08-22.md).

## Solution

### Rung 1 — `bun run test` (Vitest + Vite)

**Cannot prove: that an import resolves.** Vite's ESM interop yields `undefined`
for a missing named export instead of failing. A whole suite went green over
this:

```
$ bunx convex dev --once
✘ [ERROR] No matching export in "shared/agentHarness/execution.ts" for import "AGENT_ATTEMPT_LEASE_MS"
```

(×2, while the entire Vitest suite passed.)

**Cannot prove: any type-level claim.** Types are erased before the suite runs.
Six real errors survived a green suite in one unit alone — `rawInput` vs
`rawArgs` on the tool ledger, `attempt.diagnostic` vs `attempt.error.diagnostic`,
a duplicated `ok` key, an optional `storeId`, a `normalizedArgs` field on a viewer
shape, a `question` field on the turn-intent input.

This is the extended form of the standing "bun test cannot see type errors" rule:
it cannot see missing exports either.

### Rung 2 — scoped `tsc --noEmit`

**Cannot prove: that anything runs.** But it is the *only* sensor for type-level
assertions and for `internal.*` reachability.

Type-level assertions in a test file are invisible to Vitest. A suite passed
while two `expectTypeOf` expectations were wrong — `closeRecordRef` is
`OpaqueRef<"source"> | undefined`, not `string | undefined`. A wrong
`toEqualTypeOf` surfaces under `tsc` as:

```
Expected 1 arguments, but got 0
```

and `tsc` also reports *unused* `@ts-expect-error` directives as errors, which is
what proves every asserted compile-time error actually occurs.

A scoped run over just the test files takes about a second:

```
bunx tsc --noEmit --strict --target esnext --module esnext --moduleResolution bundler \
  --skipLibCheck --lib esnext,dom --allowImportingTsExtensions --isolatedModules \
  --moduleDetection force <test files>
```

**Adjacent trap.** `@ts-expect-error` in a test body must sit on a *type-only*
code path — an arrow body, a never-invoked function. Executing the access against
a cast `{}` throws at runtime:

```
TypeError: Cannot read properties of undefined (reading 'storeDay')
```

**Ordering note.** `bunx convex dev --once` must run *before* `tsc` whenever new
Convex modules are referenced through `internal.*`; Vitest passes regardless
because `internal` is `anyApi` at runtime.

### Rung 3 — `bunx convex dev --once` (esbuild + the real backend)

**Cannot prove: behavior.** It proves the module graph: that every import
resolves, that the bundle fits, that components mount, that the schema is
accepted, and it regenerates `convex/_generated/api.d.ts` so rung 2 has something
true to check against.

This is the rung that produced the missing-export error above, and every
constraint in the companion note.

### Rung 4 — eslint (`lint:convex:changed` and `lint:frontend:changed`)

**Cannot prove: correctness.** It catches shape rules the other rungs have no
opinion about, and it covers directories you would not expect.

`lint:frontend:changed` covers `shared/**`, not just `src/**`. A unit with no UI
files at all drew 17 findings from it — `any`, `{}` types, unused rest siblings,
unused expressions in type-only tests. Notably `no-empty-object-type` rejects the
`& {}` Simplify trick and `: {}` in conditional types; use `unknown` in
intersections instead.

`lint:convex:changed` additionally runs the pagination anti-pattern check and the
return-validator contract check, neither of which any other rung performs.

### Rung 5 — a real browser engine (Playwright / Chromium)

**Cannot prove — in jsdom:**

- **"No network request."** jsdom never fetches an `img`, `link`, or `iframe`, so
  a safe-render test there proves DOM structure only. The request claim needs a
  real engine with request interception.
- **Touch-target size or scroll ownership.** `getComputedStyle` in jsdom has no
  layout.

The browser run found two defects the jsdom suites could not:

```
✘ keeps every model URL inert while the server-minted source stays a link
   expect([data-testid="athena-agent-answer"] a).toBe(0)   → 1
✘ keeps one scroll owner …
   ["athena-agent-scroll", "athena-agent-prompt"]
```

The first was real: the source drawer was nested inside the `<article>` answer
element, so "the answer body contains no interactive element" was not literally
true; drawers became siblings. The second was an over-broad assertion — a
`<textarea>` computes `overflow-y: auto` and genuinely owns its own scroll, so
the spec now excludes form controls. Both facts are only observable with layout.

The two suites are complementary; neither replaces the other.

### Other sensor quirks worth one line each

| Quirk | Detail |
| --- | --- |
| convex-test module injection | convex-test shares module instances with the test file (same Vite module graph), so an in-process registry (`registerAgentRuntimeCleanupHook` / `resetAgentRuntimeCleanupHooksForTests`) is a clean fake-injection seam with no `vi.mock`. |
| convex-test loads everything under `convex/` | Its `import.meta.glob` loads every non-test `.ts` under `convex/`, so a reusable suite that imports `vitest` or `node:fs` must live outside it — hence `shared/agentHarness/agentRuntime.contractSuite.ts`. |
| convex-test key aliasing | A test-only Convex function module can be registered under an aliased key so an internal-path-shaped name resolves to a two-dot module: `modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"]`. |
| convex-test glob keys need normalising | Vite rewrites same-directory keys to `./name.ts`, and from a nested directory three key shapes appear. Unnormalised, you get `Error: Could not find module for: "agentHarness/agentRuntime/convexAgentSmoke"`. A guard that throws on a missing alias turns that into a one-line diagnosis. |
| Importing a `.test.ts` for helpers | Re-executes that entire suite inside the importing file — including another unit's in-flight failures. Copy the helper, or add the cases to the original file. |
| A boundary test that quotes forbidden literals | Becomes a violation of another scanner: a red once showed `8 + 7` runtime-native hits that were the boundary test's own fixture strings, and node-env tests naming `@convex-dev/agent` outside `agentRuntime/` tripped the same rule. Assemble the literals at runtime. |
| Playwright rewrites React `createElement` | Inside its own spec files `createElement` produces `{__pw_type, …}` and React refuses to render it. Render real components in a separate process (`src/tests/agent/renderAgentHostMarkup.tsx`, run via `bun`). |
| `bun` drops a mixed-import `Fragment` | `import { Fragment, type ReactNode } from "react"` fails under `bun` with `ReferenceError: Can't find variable: Fragment`; vite is fine. |
| `bun run <script> -- --flag "a b"` | Re-splits the quoted value: `bun run echo -- --reason "a b c"` yields `["--reason","a","b","c"]`, while `bun scripts/echo.ts --reason "a b c"` yields `["--reason","a b c"]`. Scripts with free-text flags must document the direct form. |
| `toMatchObject({ key: undefined })` | Requires the key to be *present* in Vitest 4. Assert absence with a separate `toBeUndefined()`. |
| Scheduled-action hosts need a pinned clock | Under convex-test, seeding at a fixed base while the host calls `Date.now()` silently expires 30-day payloads; the first host runs refused with `prompt_unavailable` until the host clock was pinned. |
| Drift fixtures and `implementationVersion` | Bumping a port's real version invalidates any fixture that used the next number as its "drifted" value. Use a version no package will ever publish (99). |
| Sibling failures in a parallel wave | Other units' in-flight files land in your sensor runs (typecheck output, whole-directory Vitest runs, `lint:convex:changed`). Report them, confirm them individually, do not fix them. |

## Prevention

Run this ordered list before calling Convex work done. Each rung's output is an
input to the next.

```
cd packages/athena-webapp

# 1. Behaviour — fastest, weakest.
bun run test -- <your files>

# 2. Module graph + backend acceptance. Regenerates convex/_generated/api.d.ts,
#    which rung 3 needs to be true.
bunx convex dev --once

# 3. Types — including internal.* reachability and type-level assertions.
bun run --filter '@athena/webapp' typecheck

# 4. Shape rules. Run BOTH; the frontend config also covers shared/**.
bun run --filter '@athena/webapp' lint:convex:changed
bun run --filter '@athena/webapp' lint:frontend:changed

# 5. Repo-specific static checks.
bun run --filter '@athena/webapp' audit:convex
bun run agent-sdk:check
git diff --check
```

Additional rungs when they apply:

- **Type-level assertions in a test file:** run the scoped `bunx tsc --noEmit …`
  command from rung 2 above over just those files — it is about a second and it
  is the only thing that verifies `expectTypeOf` and `@ts-expect-error`.
- **Anything claiming "no network request", touch-target size, scroll ownership,
  or layout:** it needs `bun run --filter '@athena/webapp' test:e2e` in a real
  engine. jsdom cannot decide it.
- **A capability or read port:** the conformance gate runs through
  `bun run agent-sdk:generate` and refuses to write on any finding; see
  [capability-authoring.md](../../../packages/athena-webapp/docs/agent/capability-authoring.md).
- **Anything touching the runtime adapter or the sandbox:** the pinned-version
  contract in
  [agent-harness-runtime.md](../../../packages/athena-webapp/docs/agent/agent-harness-runtime.md)
  is asserted by a test, so a dependency bump fails loudly rather than silently.

Two standing rules that fall out of the above:

- **A green suite is not evidence that a Convex module works.** Push and typecheck
  first. This was confirmed independently by five units.
- **When a sensor you did not run belongs to someone else's rung, run it anyway
  and report what it says.** In a parallel wave the failures may not be yours —
  confirm each one individually against the sibling's files, then report rather
  than fix.

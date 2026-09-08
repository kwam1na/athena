---
title: Raw `bun test` on a Vitest Package Needs a Runner Diagnostic, Not a Doc
date: 2026-09-08
category: developer-experience
module: repo-harness
problem_type: developer_experience
component: testing_framework
resolution_type: tooling_addition
severity: medium
applies_when:
  - An agent or subagent validates a file under packages/athena-webapp or packages/storefront-webapp
  - A test run fails on missing browser globals or a missing mocking API rather than on the code under test
  - Adding a new package whose own test script runs Vitest
tags: [bun, vitest, test-runner, bunfig, harness, agent-affordance]
delivery_diff_fingerprint: ac0f0a36d10d31bb7a8d0b7db594a919dca3e3c833d12f356a4f8aafb8742e65
---

# Raw `bun test` on a Vitest Package Needs a Runner Diagnostic, Not a Doc

## Problem

Athena's root script tests run under `bun test`, while both frontend packages
run their own suites under Vitest. The two runners share the `*.test.ts(x)`
suffix, so `bun test packages/athena-webapp/src/contexts/Foo.test.tsx` looks
like a reasonable focused command and Bun happily executes it. It then fails
inside the file with `ReferenceError: Can't find variable: window`,
`Can't find variable: document`, or a missing `vi.mock` — errors that describe
Bun's runner, not the code under test.

The repo already documented the intended runner in `AGENTS.md` and in
`packages/athena-webapp/docs/agent/testing.md`. Documentation did not stop the
misuse, because the failure arrives at the moment an agent has already decided
which command to run, and it reads as a defect in the code being validated.

## Solution

Preload a guard through Bun's own test configuration so the wrong runner stops
before it produces a misleading failure:

- `scripts/bun-test-runner-guard.ts` finds every workspace package whose own
  `test` script runs Vitest, and registers one `Bun.plugin` per package with an
  `onLoad` filter scoped to that package's directory. When Bun loads a test file
  under one of them, the guard prints the intended command and exits non-zero.
- A preload runs once per process and `Bun.main` names only one file of the
  run, so classifying that one file would miss every other target. The
  `onLoad` hook fires per file, so a multi-target or bare `bun test` is caught
  even when a root script test sorts first.
- `bunfig.toml` at the repo root wires the preload in through `[test] preload`.
- `bunfig.toml` is read from the **working directory only** — Bun does not walk
  up to a repo root — so each Vitest-owned package carries its own two-line
  `bunfig.toml` pointing at the same guard. Without those, a package-relative
  `bun test src/…` started from inside the package bypasses the guard entirely.

The diagnostic names the owning package and the exact replacement command:

```
[athena] `bun test` is not the test runner for @athena/webapp.
  file:   packages/athena-webapp/src/contexts/AppShellFullscreenContext.test.tsx
  reason: this package runs Vitest, so its tests rely on the jsdom environment and the
          `vi` mocking API. Under `bun test` they fail on unrelated errors such as
          "Can't find variable: document" or a missing `vi.mock`.
  run:    bun run --filter '@athena/webapp' test -- src/contexts/AppShellFullscreenContext.test.tsx
```

## Why This Matters

Runner selection is decided once per validation attempt, and a wrong choice
costs a full debugging detour into code that is not broken. Deriving the
package from its own `test` script rather than a hardcoded package list means
a new Vitest package is covered by the root-relative path as soon as it exists;
only the package-relative case needs the package's own `bunfig.toml`.

The guard is deliberately inert everywhere else: `scripts/*.test.ts` belong to
the root package, whose `test` script is not Vitest, so `bun run harness:test`
keeps running all 68 root script test files unchanged.

## Prevention

- Adding a package whose `test` script runs Vitest: add a two-line
  `bunfig.toml` beside its `package.json` pointing at
  `../../scripts/bun-test-runner-guard.ts`, and register that path in
  `scripts/harness-app-registry.ts` so `bun run pr:athena:preflight` stays
  green.
- `scripts/bun-test-runner-guard.test.ts` spawns real `bun test` runs from the
  repo root and from each Vitest package directory, passes a frontend file as a
  later target behind a root script test, and asserts a root script test still
  passes under the preload. Each spawn row asserts the run aborted before any
  test executed, so keep those cases when changing the guard.

## Examples

Before — the failure describes the runner, not the code:

```
$ bun test packages/athena-webapp/src/contexts/AppShellFullscreenContext.test.tsx
ReferenceError: Can't find variable: window
ReferenceError: Can't find variable: document
```

After — the failure names the intended runner, and the package-relative form is
covered too:

```
$ cd packages/athena-webapp && bun test src/contexts/AppShellFullscreenContext.test.tsx
[athena] `bun test` is not the test runner for @athena/webapp.
  run:    bun run --filter '@athena/webapp' test -- src/contexts/AppShellFullscreenContext.test.tsx
```

## Related

- [packages/athena-webapp/docs/agent/testing.md](../../../packages/athena-webapp/docs/agent/testing.md)

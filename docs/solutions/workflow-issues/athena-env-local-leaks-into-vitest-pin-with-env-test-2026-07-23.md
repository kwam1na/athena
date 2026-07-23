---
title: A Dev .env.local Leaks Into Vitest and Breaks Env-Gated Tests — Pin It With a Committed .env.test
date: 2026-07-23
category: workflow-issues
module: athena-webapp
problem_type: workflow_issue
component: test-environment
resolution_type: workflow_improvement
severity: medium
applies_when:
  - A module derives a constant from import.meta.env at load time and a test asserts that constant
  - Enabling a feature locally via .env.local makes an env-gated test fail only on your machine
  - A validation mapping (harness-app-registry.ts) gains a touchedPath and preflight fails
tags: [vitest, vite-env, env-local, env-test, harness-registry, validation-map, test-determinism]
delivery_diff_fingerprint: 7de3e8729debaf1488776b9ebbb8923260c1637582c06fee7920065b14e5100e
---

# A Dev .env.local Leaks Into Vitest and Breaks Env-Gated Tests — Pin It With a Committed .env.test

## Problem

Two `privacy.test.tsx` cases assert the pre-launch state of the register-interest
flow — that with no privacy contact configured, `WALKTHROUGH_PRIVACY_NOTICE_STATUS`
is `prelaunch_pending_owner_contact` and the page shows the "owner-approved privacy
contact" copy. That status is a module-level constant in
`lib/marketing/walkthroughPrivacy.ts`, derived from
`import.meta.env.VITE_WALKTHROUGH_PRIVACY_CONTACT` at import time.

When the interest form was enabled for local dev by adding
`VITE_WALKTHROUGH_PRIVACY_CONTACT` to `packages/athena-webapp/.env.local`, those two
tests began failing **only on the machine that had the override** — the local
`pr:athena` gate went red at `test:coverage` while CI stayed green (CI has no
`.env.local`). Vitest loads Vite env files, so the gitignored dev override leaked
into the test environment and flipped the derived constant to `ready`.

## Symptoms

- `bun run pr:athena` fails at `test:coverage` with exactly two `privacy.test.tsx`
  failures, while the same tests pass in CI and in a clean checkout.
- The failures reappear on every delivery once the dev `.env.local` override is
  restored — a recurring papercut, not a one-off.

## What Didn't Work

- **Temporarily commenting the `.env.local` line for the gate run, then restoring
  it.** It works, but it has to be repeated on every delivery and is easy to forget,
  leaving a red gate or a disabled dev form.

## Solution

Pin the variable empty in a **committed** `packages/athena-webapp/.env.test`:

```dotenv
VITE_WALKTHROUGH_PRIVACY_CONTACT=
```

Vitest runs in mode `test`, and Vite loads env files so that `.env.[mode]` outranks
`.env.local`. So `.env.test` forces the test environment to the committed
contact-unset default for everyone — regardless of any developer's `.env.local` —
without weakening the tests (the derivation still runs against a controlled empty
value and must still yield the pre-launch state). Dev is untouched: `vite` dev runs
mode `development` and never loads `.env.test`, so the local form stays enabled via
`.env.local`.

Verified by running with the dev override still present: `.env.local` sets the
contact to a real email, yet `privacy.test.tsx` passes 3/3 because `.env.test`
overrides it in test mode.

### The registry-change triad

Adding `.env.test` also made it a live app surface, which the harness contract
requires to be covered by a validation mapping. Mapping a new path in
`scripts/harness-app-registry.ts` is compound-sensitive and must be done as a triad,
or preflight fails:

1. Add the path to a scenario's `touchedPaths` (here, "Frontend test harness edits",
   which runs the package test suite).
2. Update the sibling assertion in `scripts/harness-app-registry.test.ts`.
3. Write the mapped path into the audit fixture in `scripts/harness-audit.test.ts`
   (the audit requires every mapped path to exist as a surface).

Then `bun run harness:generate` to refresh the derived validation map.

## Why This Matters

**A constant derived from `import.meta.env` at load time is only as deterministic as
the ambient env.** Any test that asserts such a constant is coupled to whatever env
files are present. A committed mode-scoped env file is the seam that makes the test
deterministic without a mock that would make the derivation assertion tautological.

**Local convenience env should never decide a test's outcome.** `.env.local` is a
per-developer, gitignored file; if it can flip a committed test, the suite is not
reproducible across machines. Pinning the relevant keys in `.env.test` restores that.

## Prevention

- When a test asserts a value derived from `import.meta.env`, pin the inputs it
  depends on in `.env.test` so the test does not depend on a developer's `.env.local`.
- Treat a "passes in CI, fails locally" test as an environment-leak signal first;
  diff the ambient env (`.env.local`, shell exports) against CI before touching the
  test.
- Any change to a compound-sensitive harness script (`harness-app-registry.ts` and
  siblings) needs the registry + sibling test + audit fixture updated together, plus
  a solution note — the sensor requires it regardless of line count.

## Related Issues

- [Shared-Demo Seeded Terminal Self-Heal](../logic-errors/athena-shared-demo-seeded-terminal-self-heal-2026-07-23.md)
  — the same delivery stream; that PR first mapped `tsconfig.json` through the same
  registry triad.

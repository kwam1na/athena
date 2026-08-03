---
title: Athena QA Smoke Must Target The Route That Owns Its Assertion
date: 2026-08-03
category: harness
module: runtime-behavior
problem_type: test_failure
component: testing_framework
symptoms:
  - "Scheduled Athena QA Smoke workflow fails every 30 minutes while QA is healthy"
  - "QA page did not render the Athena login email field. This may be a blank app shell, boot failure, or non-Athena access interstitial."
  - "Harness report shows failure in the assertion phase with no page errors and no non-2xx same-origin responses"
root_cause: missing_workflow_step
resolution_type: test_fix
severity: medium
delivery_diff_fingerprint: 1f69f50fd946d2ef45805cb33a9be98a544035ec9e51119c5fb5cc7775034298
tags:
  - ci
  - github-actions
  - playwright
  - qa
  - smoke-test
  - routing
---

# Athena QA Smoke Must Target The Route That Owns Its Assertion

## Problem

Every scheduled `Athena QA Smoke` run failed from 2026-07-28 onward while the QA
deployment was completely healthy. The smoke navigated to the site root and
asserted that `input#email[type='email']` mounts, but the root route had stopped
serving the login form.

## Symptoms

- `Athena QA Smoke` red on every 30-minute schedule; last green run 2026-07-28.
- Failure always in the `assertion` phase: "QA page did not render the Athena
  login email field."
- No page errors, no request failures, no 5xx same-origin responses — the only
  diagnostic was the missing login field, so the report read like a blank app
  shell.

## What Didn't Work

Reading the failure as an outage. The diagnostic message names a blank shell,
boot failure, or access interstitial, and none of those applied. The page was
rendering fine — it was rendering a *different, correct* page than the one the
assertion described.

## Solution

Navigate the scenario at the route that actually owns the asserted DOM, resolved
from the configured QA origin so the workflow's `ATHENA_QA_URL` stays the single
knob:

```ts
export const ATHENA_QA_LOGIN_PATH = "/login";

const qaBaseUrl = process.env.ATHENA_QA_URL ?? "https://athena-qa.wigclub.store/";
const qaOrigin = new URL(qaBaseUrl).origin;
const qaUrl = new URL(ATHENA_QA_LOGIN_PATH, qaBaseUrl).toString();
```

`qaOrigin` still drives same-origin response and request-failure filtering, so
the network diagnostics are unchanged. Only the navigation target moved.

## Why This Works

`7c6cb892` changed `AppEntryDispatcher` so that an anonymous visitor with no
prior-auth marker in `localStorage` is dispatched to `/landing` instead of
`/login`:

```ts
navigate({ to: hasAuthenticatedBefore ? "/login" : "/landing" });
```

CI drives a fresh browser profile, so it is *always* the first-time-visitor
branch and always landed on the public marketing page, which has no login form.
A returning human on the same URL still saw the login screen, which is why the
failure looked unreproducible by hand. Pointing the smoke at `/login` restores
the invariant the assertion was written against: the app shell boots and mounts
the login form.

## Prevention

- A browser smoke must navigate to the route that owns the DOM it asserts on.
  Do not rely on a root route to redirect there — redirect targets are product
  decisions that change without anyone thinking about the smoke.
- Be suspicious of entry-point redirects keyed on `localStorage`, cookies, or
  any other persisted client state: CI is permanently in the cold-start branch,
  so a cold-start-only path becomes the *only* path CI ever exercises.
- When a smoke fails identically on every scheduled run while the surface is
  healthy by hand, suspect a stale assertion target before an outage. Check
  whether the asserted route still renders what the assertion names.
- The regression test in `scripts/harness-behavior-scenarios.test.ts` pins the
  navigation target so this cannot silently drift back to the root.

## Related Issues

- `docs/solutions/harness/athena-qa-smoke-live-navigation-readiness-2026-06-01.md`
  — the same scenario's earlier fix, which moved it off `networkidle` and made
  the login-field assertion the readiness signal this note repairs.

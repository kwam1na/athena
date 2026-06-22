---
title: Athena Intelligence Readouts Need Run-Level Debug Boundaries
date: 2026-06-22
category: architecture
module: athena-webapp
problem_type: observability_gap
component: intelligence-readouts
symptoms:
  - "Operators could trigger a readout but only see a generic provider failure"
  - "In-flight provider work looked like no provider had started"
  - "Stale active runs could block regeneration after the provider path failed"
root_cause: missing_run_lifecycle_visibility
resolution_type: observability_boundary
severity: medium
tags:
  - intelligence
  - readouts
  - provider-observability
  - convex
---

# Athena Intelligence Readouts Need Run-Level Debug Boundaries

## Problem

Store and user readouts depend on an external structured-text provider, but the
operator surface originally collapsed several distinct states into the same
message. A slow provider call, a missing adapter, a provider rejection, and a
stale active run all looked like a generic failure. That made the local UI hard
to debug and made repeated generate attempts feel broken.

The backend had enough run metadata to explain the state, but the UI did not
have a bounded, full-admin debug contract. The first version also recorded the
provider invocation only after the provider returned, so an in-flight provider
call appeared as "not started" during the most important debugging window.

## Solution

Model intelligence readouts as a run lifecycle with explicit debug boundaries:

- Create a scoped `intelligenceRun` for each idempotent generation attempt.
- Mark stale active runs failed with a retryable `stale_active_run` error before
  creating a replacement run.
- Store a debug subject (`debugSubjectTable`, `debugSubjectId`) so store and
  user readouts can query the latest relevant run without unbounded source-ref
  scans.
- Record a provider invocation with status `started` before awaiting the
  provider call, then patch the same invocation to `succeeded` or `failed`.
- Pass an `AbortController` through the provider contract and into TanStack AI's
  `abortController` option so Athena's timeout reaches the provider adapter.
- Expose only allowlisted debug fields to full-admin UI: run status, data
  window, redacted snapshot summaries, provider status, sanitized diagnostics,
  and counts for evidence/source refs. Keep raw prompts, raw payloads, and full
  snapshot rows out of the browser payload.

The frontend should keep the readout itself operational and compact, with the
debug panel serving diagnosis rather than becoming the primary decision surface.

## Prevention

- Add tests at the run handler boundary for stale active run recovery and
  replacement insert behavior.
- Add tests that execute Convex `withIndex` builder callbacks and assert the
  exact indexed predicates for debug lookup paths.
- Add provider adapter tests that assert cancellation is passed using the SDK's
  real cancellation option, not a nearby unused option.
- Add lifecycle tests proving provider invocations can be visible as `started`
  before they are terminal.
- Use sanitized diagnostic fixtures in debug tests so tests do not normalize
  leaking raw provider secrets.
- For future intelligence capabilities, define the debug subject and bounded
  payload contract before adding the generate button.

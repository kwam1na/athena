---
title: "fix: Instrument the M Supplies receipt print lifecycle"
type: fix
status: active
date: 2026-08-08
---

# fix: Instrument the M Supplies receipt print lifecycle

## Summary

Add a small, temporary diagnostic around the existing receipt print flow and attach its snapshot to the existing unhandled-rejection telemetry. Reuse the current offline buffer, Convex ingestion, schema, indexes, and backend data export; collect enough M Supplies attempts to choose the later fix.

---

## Confirmed Context

Read-only production inspection on August 8 established:

- Convex contains 44 matching error rows from July 21 through August 6, 2026. Collapsing rows emitted within 10 milliseconds yields approximately 31 incidents.
- Every row maps to the same active M Supplies terminal fingerprint.
- Twenty-nine of the 31 incidents occurred 2.5–10 seconds after a completed sale. None correlated with expense completion.
- Errors continued after both attempted fixes: the print-once/closed-window guards in `fa119e3e` / #701 and the `afterprint`/60-second teardown change in `fccc6b73` / #718.
- The failures span twelve deployed `usePrint` asset hashes. The current terminal reports Windows 10, Chrome 151, and build `clever-eagle-swims (20260807133049)`.
- Current rows are generic unhandled rejections. They contain the stack and fingerprint, but not the print branch, document/window state, event order, return classification, or attempt correlation.
- Several failures appear twice within 0–1 milliseconds, so raw telemetry rows are not the same as incidents.

The strongest code-backed hypothesis is the current 1-second fallback. Its comment says it covers a load event that already finished before handler registration, but its condition calls `print()` only while `document.readyState !== "complete"`. Chromium defers printing for a loading document, introducing a delayed browsing-context boundary. This remains a hypothesis until terminal evidence distinguishes it from an overridden print function or window/callback teardown.

---

## Requirements

- R1. Give each M Supplies print attempt a stable id and retain one compact lifecycle snapshot.
- R2. Capture only the fields that discriminate the current hypotheses: invocation branch, ready state, print invocation/return, return type/thenable classification, ordered print/unload events, closed state, timing, and completion reason.
- R3. Attach the active snapshot to the existing generic rejection only when the reason matches the known print error and the attempt is recent enough to correlate honestly.
- R4. Emit one successful/completed baseline record per attempt so failures can be compared with normal prints.
- R5. Reuse the current offline telemetry buffer and backend records without schema, index, query, cron, or UI changes.
- R6. Never record receipt HTML, customer data, line items, totals, payment details, or browser function source.
- R7. Do not change print timing, fallback conditions, or cleanup behavior during data collection.

---

## Scope Boundaries

- No print behavior fix in this change.
- No new telemetry level, flow, schema field, index, backend query, retention job, or product UI.
- No changes to sale or expense receipt callers; timing correlation already isolates the sale path.
- No fleet-wide diagnostic collection. Detailed baseline records are gated to the known M Supplies terminal fingerprint.
- No permanent observability abstraction or runbook.
- The unrelated M Supplies `toLowerCase` error is out of scope.

---

## Minimal Instrumentation Design

Use a single module-level attempt slot because browser printing is modal and the affected flow can have only one active attempt in the page at a time. This is not a generalized registry.

The slot contains:

- random attempt id and start time;
- invocation source: actual `load` handler or 1-second fallback;
- document `readyState` at invocation;
- whether `print()` was invoked and returned;
- return classification: `undefined`, other primitive/object, and whether thenable inspection was safely skipped for reference values;
- a compact ordered event string for `beforeprint`, `afterprint`, `beforeunload`, `unload`, and cleanup;
- window closed state and completion reason.

The compact payload must fit inside the existing telemetry constraints: no more than 20 primitive metadata keys, with the ordered event string below the existing 300-character metadata-value limit. Use short, versioned event codes and test the maximum encoded length.

Lifecycle handlers only append checkpoints. Finalization is idempotent and emits at most one baseline record:

- if `afterprint` fires, record the checkpoint, keep the current 250ms close timing, and finalize with the `afterprint` reason after synchronous or asynchronously queued unload checkpoints have had a short diagnostic-only grace period;
- otherwise preserve the fallback-cleanup or synchronous-throw reason while recording any close/unload checkpoints before finalization;
- finalize directly on operator-initiated unload, observation expiry, or a close path whose unload grace expires;
- if a new attempt supersedes an unfinished one, finalize the old snapshot as superseded before replacing the slot.

Keep the most recent attempt available for 60 seconds after print invocation so a delayed rejection can be correlated. If another attempt starts during that retained candidate's window, mark correlation ambiguous and do not attach either attempt to a later rejection. The global `unhandledrejection` handler adds the snapshot only when the rejection message matches the exact known print signature and there is one unambiguous candidate in the window. Otherwise it records the unhandled rejection exactly as it does today with a no-candidate or ambiguous-candidate marker. Correlation supplements the error; it does not suppress or handle the rejection.

The baseline uses the existing `enqueuePosClientEvent` contract with a recognizable diagnostic message, `flow: "runtime"`, `level: "warn"`, and compact metadata. Temporary warning noise is acceptable for one fingerprint and one short evidence window. When the shared offline buffer already holds 150 of its 200 events, skip the baseline write while retaining the in-memory correlation candidate, reserving 50 slots for errors. Existing occurrence timestamps, stack asset hashes, terminal fingerprint, and runtime status provide deployment/browser context without new enrichment.

---

## Implementation Units

- U1. **Record the existing print lifecycle**

**Goal:** Capture one compact, privacy-safe snapshot for each M Supplies print attempt without changing behavior.

**Requirements:** R1, R2, R4, R5, R6, R7

**Dependencies:** None

**Files:**
- Create: `packages/athena-webapp/src/lib/pos/infrastructure/telemetry/printAttemptTelemetry.ts`
- Modify: `packages/athena-webapp/src/hooks/usePrint.ts`
- Test: `packages/athena-webapp/src/lib/pos/infrastructure/telemetry/printAttemptTelemetry.test.ts`
- Test: `packages/athena-webapp/src/tests/pos/usePrint.test.ts`

**Approach:**
- Gate detailed capture with the stored M Supplies fingerprint; all other terminals follow the current code path with no diagnostic writes. The fingerprint is a temporary rollout selector, not an authorization boundary, and backend analysis must still restrict rows to the known store/terminal association.
- Start the single attempt slot before `window.open`, update it only at existing lifecycle seams, and finalize it once under the precedence rules above.
- Classify the print function return without reading an arbitrary `.then` property, attaching Promise/thenable handlers, or serializing function source.
- Emit the compact baseline through the existing telemetry buffer.
- Leave the suspicious ready-state condition and all current close timers unchanged.

**Execution note:** Add characterization assertions around the current branches before adding checkpoint calls. The assertions should prove instrumentation did not change which branch invokes `print()` or when cleanup occurs.

**Test scenarios:**
- Actual load path records `readyState`, invocation/return, event order, and one completion snapshot.
- The 1-second path records that it invoked while the document was still loading.
- `afterprint` before print return and `afterprint` after return each finalize exactly once with complete ordering.
- Unload, synchronous throw, fallback cleanup, observation expiry, and superseding attempt each finalize exactly once with the correct reason.
- An `undefined` native-style return is classified as non-thenable; reference returns are marked `not_inspected` without reading a potentially side-effecting `.then` property.
- Non-M-Supplies fingerprints emit no detailed baseline record.
- Receipt content containing customer/payment-like strings never appears in the event message or metadata.
- The maximum event ordering stays below the existing 300-character metadata limit and the complete payload stays within 20 keys.

**Verification:**
- Existing print behavior tests remain unchanged in outcome, while new assertions can distinguish actual-load success, loading-fallback attempts, and teardown sequences.

---

- U2. **Correlate the known rejection and collect evidence**

**Goal:** Attach the print snapshot to matching failures and produce a small backend comparison for sign-off.

**Requirements:** R2, R3, R5, R6

**Dependencies:** U1

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/infrastructure/telemetry/usePosClientTelemetryDrain.ts`
- Test: `packages/athena-webapp/src/lib/pos/infrastructure/telemetry/usePosClientTelemetryDrain.test.ts`

**Approach:**
- When `unhandledrejection` receives the exact print signature, request the recent attempt snapshot from the helper and merge its primitive fields into the existing error metadata.
- If there is no recent attempt, retain the original generic error with an explicit “no print candidate” marker rather than manufacturing correlation.
- Deploy to M Supplies and use the existing read-only `posClientEvent` export. Group baseline/error rows offline by attempt id and report raw rows separately from deduplicated attempts.
- Compare successful and failed attempts by invocation branch, ready state, return classification, event order, closed state, and completion reason.

**Test scenarios:**
- Exact print rejection within 60 seconds receives the current attempt id and snapshot.
- An unrelated rejection during the same window is not attributed to printing.
- A matching rejection after expiry remains generic and records that no candidate was available.
- A second sequential print inside the first attempt's correlation window makes later matching rejection correlation ambiguous rather than assigning it to the newer attempt.
- Duplicate global listeners may produce multiple raw rows, but their shared attempt id allows offline deduplication.
- Correlation metadata remains within existing limits and contains no receipt/business content.

**Verification:**
- A production export can join a matching error to its print attempt without any backend code or schema change.

---

## Collection and Sign-Off

Collect for five business days. Review early if the dataset reaches at least 50 attempts and 5 failures; force a review at seven calendar days even if those thresholds are not met.

The read-only export is handled as temporary incident data: an authorized full administrator limits it to the M Supplies store/terminal, collection window, and fields required by this plan; stores it only in the approved encrypted workspace; shares summaries rather than raw rows; and deletes the raw export after sign-off. After the follow-up decision, remove the temporary diagnostic baseline rows from Convex using the diagnostic version, terminal, and time bounds. Existing error rows remain under the current incident-evidence policy.

The review reports:

- raw error rows, deduplicated failures, total baseline attempts, and correlation coverage;
- success versus failure counts for actual-load and 1-second-fallback branches;
- ready-state and return/thenable distributions;
- event-order and completion-reason differences;
- evidence that contradicts the leading explanation, not only evidence that supports it.

Possible outcomes:

| Evidence | Authorized next step |
|---|---|
| Failures cluster on the 1-second path while loading | Propose correcting the inverted fallback and waiting for document completion. |
| Failures expose a thenable/overridden print contract | Investigate and handle the terminal environment's print bridge contract. |
| Failures follow unload/close or callback-context loss | Propose moving lifecycle ownership so the print context remains runnable. |
| No stable discriminator or insufficient sample | Do not change printing; reproduce under the captured Chrome/build with browser-level tracing. |

The instrumentation change is successful if it produces a discriminating comparison or honestly establishes that browser-level reproduction is required. It is not required to select a behavioral fix when the evidence does not support one.

---

## Risks and Guardrails

| Risk | Guardrail |
|---|---|
| Instrumentation perturbs the race | Keep checkpoint work synchronous, bounded, and in memory; only the existing local buffer write occurs at finalization. |
| A coincident or sequential rejection is misattributed | Match the exact error signature, require one unambiguous M Supplies candidate within 60 seconds, and refuse correlation after another attempt starts. |
| Duplicate listeners inflate severity | Report raw rows and deduplicated attempt ids separately. |
| The baseline fills the local buffer | Skip baseline writes at 150 buffered events, retaining 50 of the 200 slots for error evidence; the in-memory candidate and existing 30-second drain continue unchanged. |
| Temporary canary code or data remains | The follow-up fix must remove the fingerprint gate and detailed checkpoints, delete diagnostic baseline rows and the raw export, or explicitly justify retaining a coarse outcome event. |

---

## Verification Strategy

- Focused Vitest coverage for the helper, existing print branches, payload bounds/privacy, and rejection correlation.
- Do not claim the object-window unit tests reproduce Chromium. Production evidence is the decisive sensor for this instrumentation pass.
- Use a real Chromium popup smoke test only if the existing browser harness supports it without adding new infrastructure.
- At a merge-ready boundary run `bun run pr:athena`.
- After implementation run `bun run graphify:rebuild`.

---

## Sources & References

- Print implementation: `packages/athena-webapp/src/hooks/usePrint.ts`
- Existing buffer: `packages/athena-webapp/src/lib/pos/infrastructure/telemetry/telemetryBuffer.ts`
- Existing rejection capture/drain: `packages/athena-webapp/src/lib/pos/infrastructure/telemetry/usePosClientTelemetryDrain.ts`
- Existing backend ingestion/query: `packages/athena-webapp/convex/pos/public/telemetry.ts`
- Existing field-evidence learning: `docs/solutions/architecture/athena-pos-field-evidence-surfaces-2026-05-20.md`
- Prior attempts: commits `fa119e3e` (#701) and `fccc6b73` (#718)
- Production evidence: read-only `posClientEvent`, `posTerminal`, `posTerminalRuntimeStatus`, `posTransaction`, and `expenseTransaction` inspection on 2026-08-08
- Chromium print deferral: <https://chromium.googlesource.com/chromium/src/+/2e0d8da7d8c14e462ca7adc77d6a417c3d9918e8/third_party/blink/renderer/core/frame/local_dom_window.cc>
- Chromium callback runnable check: <https://chromium.googlesource.com/chromium/src/+/474eca05898d2524072c2e3d962a866ddcfe37fc/third_party/blink/renderer/bindings/tests/results/core/v8_void_callback_function.cc>
- Window print API: <https://developer.mozilla.org/en-US/docs/Web/API/Window/print>

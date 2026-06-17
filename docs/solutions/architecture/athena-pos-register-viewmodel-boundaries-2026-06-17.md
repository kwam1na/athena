---
title: Athena POS Register View Model Boundary Extraction
date: 2026-06-17
category: architecture
module: athena-webapp
problem_type: architecture_pattern
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "Refactoring a local-first POS hook that mixes projection helpers, runtime ownership, and mutation queues"
  - "Adding POS register behavior where local durability must remain visible before cloud sync finishes"
  - "Reducing Graphify hotspots without changing the UI-facing RegisterViewModel contract"
tags:
  - pos
  - register
  - local-first
  - view-model
  - graphify
---

# Athena POS Register View Model Boundary Extraction

## Problem

`useRegisterViewModel` is the stable facade consumed by `POSRegisterView`, but
it can become a risky hotspot when it owns every concern directly: local store
creation, sync runtime wiring, cashier presence restoration, drawer lifecycle
presentation, cart projection, payment queues, checkout completion, and final UI
assembly.

That shape makes local-first POS work fragile because a small change in one
workflow can accidentally disturb shared refs, mutation locks, or projection
helpers used by another workflow. The safe refactor path is to preserve the
facade while extracting boundaries behind it.

## Solution

Keep `useRegisterViewModel()` as the public hook while moving behavior into
small modules by responsibility:

- Pure projection helpers belong in files such as `registerCartProjection.ts`,
  `registerCheckoutProjection.ts`, `registerCashierPresence.ts`, and
  `registerDrawerPresentation.ts`.
- Local runtime ownership belongs in one hook, `useRegisterLocalRuntime`, that
  creates the local store and command gateway, owns projected read-model refresh,
  advances event append tokens, checks seed readiness, and feeds sync runtime
  presentation inputs.
- Checkout draft mechanics belong in a small hook such as
  `useRegisterCheckoutDraftState`, which owns payment refs, checkout versioning,
  mutation queues, and the shared checkout lock.
- Drawer command failures should preserve actionable command messages while
  normalizing raw local-store infrastructure failures back to calm retry copy.
- Keep the UI contract in `registerUiState.ts` unchanged unless there is a
  separate UI migration plan.

The refactor should be characterized by fast tests around each extracted module
plus the existing `useRegisterViewModel.test.ts` integration suite. Do not rely
only on the large integration file for helper-level behavior; otherwise every
helper change requires re-entering the full hook setup.

## Why This Matters

The POS register is local-first. Cashiers should see local actions only after
the local event is durable, and sync/recovery state should stay visible without
blocking ordinary selling unnecessarily. Centralizing local runtime ownership
prevents duplicate store factories and stale seed checks. Centralizing checkout
queue mechanics prevents cart, service, payment, and completion flows from
drifting into different lock semantics.

Graphify hotspot reduction is a useful signal, but the extraction boundary
should be behavioral rather than line-count driven. A thin-looking facade that
leaks runtime ownership or queue refs back into unrelated modules is still
risky; a facade that composes tested local-runtime, projection, drawer, and
checkout helpers is easier to extend.

## When to Apply

- `useRegisterViewModel.ts` is gaining another inline helper or local runtime
  callback.
- A POS change needs to read the projected local register model or append local
  events.
- Payment, cart, service-line, or checkout code needs to coordinate with the
  checkout mutation lock.
- Drawer lifecycle copy needs to distinguish actionable command errors from raw
  storage failures.
- Graphify identifies the register view model as a high-edge hotspot.

## Prevention

- Add fast unit tests beside each extracted helper or boundary hook before
  deleting inline copies from the facade.
- Keep `registerUiState.ts` as the UI contract and treat changes to it as a
  separate migration, not incidental refactor work.
- Review new POS register changes for ad hoc local store creation, duplicate
  sync-status wiring, or separate checkout mutation queues.
- Run the focused register tests plus `tsc`, build, changed-file lint, and
  Graphify rebuild after boundary extractions.
- Document any new boundary pattern in `docs/solutions/` when the source diff
  is large enough to affect future agent work.

## Examples

Prefer this pattern:

```ts
const {
  localCommandGateway,
  localRegisterReadModel,
  noteLocalRegisterEventChanged,
  hasProvisionedLocalSyncSeed,
} = useRegisterLocalRuntime({
  activeStoreId,
  createLocalFallbackId,
  onRetryBootstrap: requestBootstrap,
  staffProfileId,
  staffProfileIdRef,
  staffProofToken,
  staffProofTokenRef,
  terminal,
});
```

Over recreating local store/runtime callbacks inline in the register facade.

For checkout state, prefer a single draft state hook:

```ts
const {
  checkoutMutationLockedRef,
  enqueueCartMutation,
  enqueuePaymentQueueMutation,
  enqueueServiceMutation,
  waitForCheckoutMutationQueues,
} = useRegisterCheckoutDraftState();
```

This keeps cart, service, payment, clear-sale, and completion flows on one
ordering model.

## Related

- `docs/solutions/logic-errors/athena-pos-local-sync-review-and-service-lines-2026-05-29.md`
- `docs/solutions/logic-errors/athena-pos-register-local-catalog-search-2026-05-04.md`
- `docs/solutions/logic-errors/athena-pos-drawer-authority-replacement-recovery-2026-06-06.md`
- `docs/solutions/architecture/athena-pos-terminal-recovery-readiness-boundary-2026-06-14.md`

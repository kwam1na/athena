---
title: fix: Centralize register-session status policy for POS drawer readiness
type: fix
status: active
date: 2026-04-24
---

# fix: Centralize register-session status policy for POS drawer readiness

## Overview

Fix the lingering POS drawer bootstrap bug by making register-session status semantics explicit. `open` and `active` are usable for POS sale work, `closing` is visible to cash-control closeout but not usable for POS, and `closed` is historical. The implementation should remove duplicated local interpretations of those states so future lifecycle edge cases are handled by one shared policy.

---

## Problem Frame

The observed bug is an authenticated cashier reaching POS and getting "Open the cash drawer before starting a sale" when the resolved register session is `closing`. The first-principles issue is broader: multiple layers encode status meaning independently.

- POS command boundaries reject non-usable drawers using local `open || active` helpers.
- POS active-drawer lookup currently returns any non-closed drawer.
- Browser bootstrap treats any non-null `activeRegisterSession` as drawer-ready.
- Cash-control views intentionally include `closing`.
- Duplicate-drawer conflict checks intentionally block `closing`.

Those are different policies, not one policy with different names. This plan makes the policies explicit and routes callers through the right one.

---

## Requirements Trace

- R1. POS sale readiness accepts only `open` and `active` register sessions.
- R2. Cash-control operational visibility includes `open`, `active`, and `closing`.
- R3. Duplicate drawer opening remains blocked by `open`, `active`, and `closing`.
- R4. Browser bootstrap must not auto-start, auto-resume, or auto-bind using stale `closing` drawer data.
- R5. Regression coverage must include a status matrix plus the server and browser closing-drawer bug paths.

---

## Scope Boundaries

- Do not change register-session lifecycle transitions.
- Do not allow a new drawer while a previous drawer is still `closing`.
- Do not hide `closing` sessions from closeout/deposit/dashboard cash-control surfaces.
- Do not add public Convex functions or generated client artifacts.

---

## Context & Research

### Relevant Code and Patterns

- `packages/athena-webapp/convex/operations/registerSessions.ts` owns register-session lifecycle transitions and active-drawer lookup.
- `packages/athena-webapp/convex/pos/application/commands/sessionCommands.ts`, `packages/athena-webapp/convex/inventory/posSessions.ts`, and `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts` duplicate POS-usable status checks.
- `packages/athena-webapp/convex/cashControls/paymentAllocationAttribution.ts` duplicates in-store collection status checks.
- `packages/athena-webapp/convex/cashControls/deposits.ts` duplicates dashboard visibility buckets.
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts` currently relies on non-null drawer DTOs instead of drawer usability.

### Institutional Learnings

- `docs/solutions/logic-errors/athena-pos-drawer-invariants-at-command-boundaries-2026-04-24.md` says POS drawer invariants belong at command boundaries; this fix adds a shared status vocabulary so read-side bootstrap and write-side validation agree.

### External References

- Not used. The repo has direct local patterns for this lifecycle domain.

---

## Key Technical Decisions

- Add a browser-safe shared status policy module under `packages/athena-webapp/shared`.
- Keep policy names context-specific: POS usability, cash-control visibility, and duplicate-drawer conflict blocking.
- Replace duplicated local predicates with the shared policy where the policy is semantically the same.
- Keep exact lifecycle transition logic in `operations/registerSessions.ts`; transitions are not the same thing as contextual status policy.

---

## Implementation Units

- [ ] U1. **Add shared register-session status policy**

**Goal:** Define the domain vocabulary once and cover it with a status matrix.

**Requirements:** R1, R2, R3, R5

**Dependencies:** None

**Files:**
- Create: `packages/athena-webapp/shared/registerSessionStatus.ts`
- Test: `packages/athena-webapp/shared/registerSessionStatus.test.ts`

**Approach:**
- Export `RegisterSessionStatus` and named predicates for POS usability, cash-control visibility, and duplicate-drawer conflict blocking.
- Accept unknown/string status input at call sites that receive persisted documents so invalid or absent values fail closed.

**Execution note:** Test-first.

**Patterns to follow:**
- Browser-safe shared helpers in `packages/athena-webapp/shared/commandResult.ts`.

**Test scenarios:**
- Status matrix: `open` and `active` are POS-usable; `closing` and `closed` are not.
- Status matrix: `open`, `active`, and `closing` block duplicate drawer opening; `closed` does not.
- Status matrix: `open`, `active`, and `closing` are cash-control visible; `closed` is not.

**Verification:**
- Shared policy tests pass and the module can be imported from both Convex and browser code.

---

- [ ] U2. **Replace server-side duplicated status checks**

**Goal:** Make POS commands, POS active-drawer lookup, inventory session mutation, in-store payment attribution, and cash-control dashboard bucketing use the shared policy.

**Requirements:** R1, R2, R3, R5

**Dependencies:** U1

**Files:**
- Modify: `packages/athena-webapp/convex/operations/registerSessions.ts`
- Modify: `packages/athena-webapp/convex/pos/application/commands/sessionCommands.ts`
- Modify: `packages/athena-webapp/convex/inventory/posSessions.ts`
- Modify: `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts`
- Modify: `packages/athena-webapp/convex/cashControls/paymentAllocationAttribution.ts`
- Modify: `packages/athena-webapp/convex/cashControls/deposits.ts`
- Test: `packages/athena-webapp/convex/operations/registerSessions.trace.test.ts`
- Test: `packages/athena-webapp/convex/pos/application/sessionCommands.test.ts`
- Test: existing targeted tests for touched cash-control/transaction surfaces as needed

**Approach:**
- Use POS usability for active drawer lookup and command/session mutation boundaries.
- Use duplicate-drawer conflict blocking for open-drawer conflict detection.
- Use cash-control visibility for dashboard lists and closeout-facing buckets.
- Preserve explicit command validation failures for `closing` register-session ids.

**Execution note:** Test-first for the known closing-drawer server path.

**Patterns to follow:**
- Existing command-boundary validation in `sessionCommands.ts`.
- Existing cash-control dashboard buckets in `deposits.ts`.

**Test scenarios:**
- Server edge case: latest register/terminal session is `closing` -> POS active drawer lookup returns `null`.
- Server happy path: latest register/terminal session is `open` or `active` -> POS active drawer lookup returns it.
- Conflict path: opening a drawer while latest session is `closing` still fails as duplicate/non-closed conflict.
- Command path: explicit `closing` register-session id still returns `validationFailed` and creates no POS session.

**Verification:**
- Server status semantics are expressed through the shared policy and all targeted server tests pass.

---

- [ ] U3. **Defend browser bootstrap against stale closing-drawer DTOs**

**Goal:** Prevent stale or cached `closing` drawer data from enabling POS bootstrap on the client.

**Requirements:** R1, R4, R5

**Dependencies:** U1, U2

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Test: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`

**Approach:**
- Derive a `usableActiveRegisterSession` from `activeRegisterSession` and the shared POS usability predicate.
- Use that derived drawer id for auto-start, manual start, recovery binding, and drawer-gate decisions.
- Treat a non-usable active register session as missing drawer state for startup and as recovery gate state when a POS session is already active.

**Execution note:** Test-first for the authenticated cashier plus `closing` drawer state.

**Patterns to follow:**
- Existing missing-drawer and mismatched-drawer tests in `useRegisterViewModel.test.ts`.

**Test scenarios:**
- Browser edge case: `activeRegisterSession.status = "closing"` with no active POS session -> drawer gate renders, product entry is disabled, and `startSession` does not fire.
- Browser recovery edge case: active POS session bound to a `closing` drawer -> recovery gate renders, product entry is disabled, and no start/bind command fires.
- Happy path: `open` and `active` drawers continue to support current POS bootstrap behavior.

**Verification:**
- Authenticated cashiers never reach live POS bootstrap because of a `closing` drawer.

---

- [ ] U4. **Validate and refresh generated graph artifacts**

**Goal:** Prove the foundational fix and keep repo graph artifacts current.

**Requirements:** R5

**Dependencies:** U1, U2, U3

**Files:**
- Modify: `graphify-out/GRAPH_REPORT.md`
- Modify: `graphify-out/graph.json`
- Modify: `graphify-out/wiki/index.md`
- Modify: `graphify-out/wiki/packages/athena-webapp.md`

**Approach:**
- Run targeted tests first, then relevant Convex audit/lint, typecheck, build, and graphify rebuild.
- Update the existing solution note only if implementation reveals a reusable nuance beyond the status policy captured here.

**Execution note:** Sensor-only for generated artifacts.

**Patterns to follow:**
- `packages/athena-webapp/docs/agent/testing.md` POS register bootstrap and cash-control validation guidance.

**Test scenarios:**
- Test expectation: none -- this unit validates and refreshes derived artifacts rather than changing behavior.

**Verification:**
- Targeted and relevant broader sensors pass or any unrelated blocker is documented precisely.

---

## System-Wide Impact

- **Interaction graph:** Shared status policy feeds POS commands, POS active-drawer lookup, browser bootstrap, cash-control dashboard, and payment attribution.
- **Error propagation:** Invalid POS drawer states should be stopped before bootstrap where possible and remain safe command-result failures where direct command calls occur.
- **State lifecycle risks:** `closing` remains closeout-only and duplicate-opening remains blocked until `closed`.
- **API surface parity:** No public API or DTO status union changes.
- **Integration coverage:** Matrix tests plus server/browser regressions cover the exact context split that caused the bug.
- **Unchanged invariants:** Register-session transitions remain `open -> active/closing`, `active -> closing`, and `closing -> closed`.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A shared helper could overgeneralize status semantics | Keep separate context-specific predicate names instead of one vague `isActive` helper |
| Filtering `closing` too broadly could break closeout surfaces | Use cash-control visibility predicate for closeout/dashboard code |
| Browser and server could drift again | Import the same browser-safe policy module on both sides |

---

## Documentation / Operational Notes

- If this fix lands, the existing POS drawer invariant solution note should mention the shared status-policy layer as the durable prevention mechanism.

---

## Sources & References

- Related Linear issue: V26-379
- Related learning: `docs/solutions/logic-errors/athena-pos-drawer-invariants-at-command-boundaries-2026-04-24.md`
- Related code: `packages/athena-webapp/convex/operations/registerSessions.ts`
- Related code: `packages/athena-webapp/convex/pos/application/commands/sessionCommands.ts`
- Related code: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`

---
title: fix: Finish POS closeout-blocked drawer gate
type: fix
status: active
date: 2026-04-24
---

# fix: Finish POS closeout-blocked drawer gate

## Overview

Finish the remaining POS register-session status fix by distinguishing a missing drawer from a drawer that is already in `closing` status. The shared status policy and server-side guards already classify `closing` correctly: it is not POS-usable, but it still blocks opening a duplicate drawer. The remaining implementation should make the POS drawer gate reflect that product reality: when a register session is `closing`, cashiers should be sent to Cash Controls to finish closeout, not shown an opening-float form that can only fail.

---

## Problem Frame

The observed failure path is an authenticated cashier entering POS with a resolved register session in `closing` status. POS correctly withholds sale controls, but the current drawer gate still looks like ordinary drawer setup. If the cashier submits the form, `openDrawer` reaches `findConflictingRegisterSession`, which correctly rejects the attempt with "A register session is already open for this register."

That server rejection is the right invariant, but it is the wrong user journey. A `closing` drawer is not absent; it is awaiting cash-control closeout. POS should render a closeout-blocked state with no open-drawer submit action.

---

## Requirements Trace

- R1. POS sale readiness accepts only `open` and `active` register sessions.
- R2. Cash-control operational visibility includes `open`, `active`, and `closing`.
- R3. Duplicate drawer opening remains blocked by `open`, `active`, and `closing`.
- R4. Browser bootstrap must not auto-start, auto-resume, auto-bind, or open a drawer using stale `closing` drawer data.
- R5. POS must render a closeout-blocked drawer gate, without an open-drawer submit action, when the current register session is `closing`.
- R6. Existing missing-drawer setup and recovery flows must continue to open or bind a POS-usable drawer.
- R7. Regression coverage must prove the closeout-blocked browser path plus the existing shared status and server conflict matrix.

---

## Scope Boundaries

- Do not change register-session lifecycle transitions.
- Do not allow a new drawer while a previous drawer is still `closing`.
- Do not hide `closing` sessions from closeout, deposit, dashboard, or register-session cash-control surfaces.
- Do not present a closing register session as an ordinary "open a drawer" setup task in POS.
- Do not add public Convex functions or generated client artifacts.
- Do not redesign Cash Controls closeout; POS should only route the operator there.

---

## Context & Research

### Relevant Code and Patterns

- `packages/athena-webapp/shared/registerSessionStatus.ts` already defines browser-safe predicates for POS usability, duplicate-drawer conflict blocking, and cash-control visibility.
- `packages/athena-webapp/shared/registerSessionStatus.test.ts` already covers the status matrix: `open` and `active` are POS-usable; `closing` remains conflict-blocking and cash-control visible.
- `packages/athena-webapp/convex/operations/registerSessions.ts` already uses the shared predicates for active-drawer lookup and duplicate-drawer conflict checks.
- `packages/athena-webapp/convex/operations/registerSessions.trace.test.ts` already covers the server edge case: `closing` is not returned for POS active drawer lookup and still blocks duplicate opening.
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts` already derives `usableActiveRegisterSession` and blocks bootstrap from `closing`, but it still exposes the same drawer gate shape used by missing-drawer setup.
- `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx` renders one submit-oriented form for both initial setup and recovery.
- `packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx` centralizes the gate rendering, so the closeout-blocked variant should remain contained within the drawer-gate presentation path.

### Institutional Learnings

- `docs/solutions/logic-errors/athena-pos-drawer-invariants-at-command-boundaries-2026-04-24.md` says POS drawer invariants belong at command boundaries. This plan keeps those backend protections and fixes the browser experience so the cashier does not enter a doomed command path.

### External References

- Not used. The repo has direct local patterns for this POS and cash-control lifecycle.

---

## Key Technical Decisions

- Preserve the shared status policy as the source of truth. `closing` remains not POS-usable, conflict-blocking, and cash-control visible.
- Represent closeout-blocked POS state explicitly in the drawer gate view model instead of overloading `initialSetup` or `recovery`.
- Remove the `openDrawer` submit affordance only for the `closing` state. Missing-drawer setup and recovery continue to use the opening-float form.
- Keep Cash Controls navigation and cashier sign-out available from the blocked state.
- Keep server conflict mapping as defense in depth for stale or racy clients; the main fix is preventing the submit path when the client already knows the drawer is `closing`.

---

## Open Questions

### Resolved During Planning

- Should POS allow the cashier to open another drawer while the current register session is `closing`? No. The existing duplicate-drawer conflict is correct; POS should route to closeout.
- Should the closeout-blocked gate keep the open-drawer form but disable submit? No. The chosen behavior is a distinct closeout-blocked gate with no open-drawer submit action.

### Deferred to Implementation

- Exact view-model field names for the blocked state: decide while editing `RegisterDrawerGateState`, but keep the state explicit and type-checked.
- Exact heading/body copy: choose concise operator-facing copy while preserving the requirement that the next action is Cash Controls, not drawer opening.

---

## Implementation Units

- [x] U1. **Shared register-session status policy baseline**

**Goal:** Recognize that the shared status semantics are already present and should not be reimplemented.

**Requirements:** R1, R2, R3, R7

**Dependencies:** None

**Files:**
- Existing: `packages/athena-webapp/shared/registerSessionStatus.ts`
- Existing test: `packages/athena-webapp/shared/registerSessionStatus.test.ts`

**Approach:**
- Keep the existing predicates and status matrix.
- Do not introduce a broader `isActive` style helper that blurs POS usability, cash-control visibility, and duplicate-drawer conflict blocking.

**Patterns to follow:**
- Browser-safe shared helpers in `packages/athena-webapp/shared/commandResult.ts`.

**Test scenarios:**
- Already covered: `closing` is not POS-usable.
- Already covered: `closing` remains duplicate-drawer conflict-blocking.
- Already covered: `closing` remains cash-control visible.

**Verification:**
- Existing shared policy tests remain green after the UI change.

---

- [x] U2. **Server-side status policy baseline**

**Goal:** Recognize that server lookup and conflict behavior already enforce the desired invariant.

**Requirements:** R1, R3, R4, R7

**Dependencies:** U1

**Files:**
- Existing: `packages/athena-webapp/convex/operations/registerSessions.ts`
- Existing test: `packages/athena-webapp/convex/operations/registerSessions.trace.test.ts`
- Existing related commands: `packages/athena-webapp/convex/pos/application/commands/sessionCommands.ts`
- Existing related commands: `packages/athena-webapp/convex/inventory/posSessions.ts`
- Existing related commands: `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts`

**Approach:**
- Keep active-drawer lookup restricted to POS-usable statuses.
- Keep duplicate opening blocked for `closing`.
- Keep explicit command-boundary validation for direct calls or stale clients.

**Patterns to follow:**
- Existing command-boundary validation in `packages/athena-webapp/convex/pos/application/commands/sessionCommands.ts`.

**Test scenarios:**
- Already covered: latest register or terminal session is `closing` -> POS active drawer lookup returns `null`.
- Already covered: latest session is `open` -> POS active drawer lookup returns it.
- Already covered: opening a drawer while the latest session is `closing` still fails as a duplicate conflict.

**Verification:**
- Existing server trace tests remain green after the UI change.

---

- [ ] U3. **Add closeout-blocked drawer gate state**

**Goal:** Make the POS view model distinguish `closing` from an actually missing drawer.

**Requirements:** R4, R5, R6, R7

**Dependencies:** U1, U2

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/presentation/register/registerUiState.ts`
- Modify: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Test: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`

**Approach:**
- Detect whether `registerState.activeRegisterSession?.status` is `closing` separately from whether `usableActiveRegisterSession` is missing.
- Expose a closeout-blocked drawer gate state that does not provide an open-drawer submit action.
- Preserve the existing missing-drawer `initialSetup` and recovery behavior for `null`, `closed`, or otherwise non-usable drawer state that is not a known `closing` session.
- Continue to block product entry and checkout mutation while the closeout-blocked gate is active.
- Do not auto-start, auto-resume, or auto-bind a POS session against the `closing` register-session id.

**Execution note:** Implement the new view-model state test-first so the type shape forces the component to handle the non-submittable variant.

**Patterns to follow:**
- Existing missing-drawer and mismatched-drawer tests in `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`.
- Existing `usableActiveRegisterSession` derivation in `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`.

**Test scenarios:**
- Happy path: `activeRegisterSession.status = "closing"` with no active POS session -> drawer gate reports a closeout-blocked setup state, product entry is disabled, `startSession` is not called, and no open-drawer submit handler is exposed.
- Recovery path: active POS session plus `activeRegisterSession.status = "closing"` -> drawer gate reports a closeout-blocked recovery state, cart/customer/payment draft remains visible through view-model state as appropriate, and no start/bind/open-drawer command fires.
- Happy path preservation: `activeRegisterSession.status = "open"` or `active` continues to bootstrap or allow start behavior as it does today.
- Missing-drawer preservation: `activeRegisterSession = null` still renders the submit-capable drawer setup or recovery gate and can call `openDrawer`.

**Verification:**
- The view model exposes closeout-blocked state only for known `closing` sessions.
- Existing drawer recovery and missing-drawer tests continue to pass.

---

- [ ] U4. **Render closeout-blocked drawer gate UI**

**Goal:** Replace the opening-float form with closeout guidance when the gate is closeout-blocked.

**Requirements:** R5, R6, R7

**Dependencies:** U3

**Files:**
- Modify: `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`
- Test: `packages/athena-webapp/src/components/pos/register/POSRegisterView.test.tsx`

**Approach:**
- For closeout-blocked state, render concise copy that tells the operator the register is closing and must be finished in Cash Controls before selling.
- Keep the Cash Controls link available and visually primary enough to be the next operational action.
- Keep sign out available.
- Do not render opening float, notes, or "Open drawer" submit controls for closeout-blocked state.
- Preserve existing setup and recovery form copy for normal missing-drawer flows.

**Patterns to follow:**
- Existing Cash Controls link in `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`.
- Existing POS page behavior in `packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx`, which hides sale controls while `drawerGate` is present.

**Test scenarios:**
- Happy path: closeout-blocked drawer gate renders closeout copy, Cash Controls action, and sign-out action.
- Error prevention: closeout-blocked drawer gate does not render opening-float input, notes textarea, or "Open drawer" submit button.
- Preservation: initial setup drawer gate still renders opening-float input, notes textarea, submit button, Cash Controls action, and sign-out action.
- Preservation: recovery drawer gate still renders recovery copy and the submit-capable drawer-opening form.

**Verification:**
- POS renders the closeout-blocked gate instead of sale controls when the view model supplies it.
- Existing setup and recovery gate component tests remain green.

---

- [ ] U5. **Keep stale-client conflict handling safe**

**Goal:** Ensure that if a stale or racing client still attempts `openDrawer`, the user receives inline guidance rather than an uncaught exception or misleading recovery path.

**Requirements:** R3, R4, R5, R7

**Dependencies:** U3

**Files:**
- Review/modify: `packages/athena-webapp/convex/pos/application/commands/register.ts`
- Review/modify: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Test: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`

**Approach:**
- Preserve current `CommandResult` conflict mapping in the Convex command boundary.
- If the browser receives a duplicate-drawer conflict from `openDrawer`, keep it inline in the drawer gate and avoid toast-only failure.
- Prefer product-safe wording that does not promise the cashier can resolve the issue by submitting again.
- Do not weaken the server-side duplicate conflict to make the UI flow pass.

**Patterns to follow:**
- Existing inline `drawerErrorMessage` handling in `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`.
- Shared command-result error pattern documented in `packages/athena-webapp/docs/agent/testing.md`.

**Test scenarios:**
- Error path: `openDrawer` returns a duplicate-register or duplicate-terminal conflict -> drawer gate remains visible, error copy renders inline, and no `startSession` call fires.
- Regression: unexpected command failures continue to use the existing error propagation behavior.

**Verification:**
- Stale-client conflict handling remains a safe fallback, but known `closing` state no longer exposes the submit path.

---

- [ ] U6. **Validate and refresh generated graph artifacts**

**Goal:** Prove the focused UI fix and keep repo graph artifacts current after code changes.

**Requirements:** R7

**Dependencies:** U3, U4, U5

**Files:**
- Modify: `graphify-out/GRAPH_REPORT.md`
- Modify: `graphify-out/graph.json`
- Modify: `graphify-out/wiki/index.md`
- Modify: `graphify-out/wiki/packages/athena-webapp.md`
- Review/update if implementation reveals a reusable nuance: `docs/solutions/logic-errors/athena-pos-drawer-invariants-at-command-boundaries-2026-04-24.md`

**Approach:**
- Run the focused POS drawer-gate/view-model tests first.
- Run the existing shared status and server register-session tests to prove the baseline still holds.
- Follow `packages/athena-webapp/docs/agent/testing.md` for the appropriate POS register bootstrap validation slice.
- Run `bun run graphify:rebuild` after code files are modified, per repo instructions.

**Patterns to follow:**
- Validation guidance in `packages/athena-webapp/docs/agent/testing.md`.
- Repo graphify rule in `AGENTS.md`.

**Test scenarios:**
- Test expectation: none for generated graph artifacts; this unit validates behavior and refreshes derived documentation.

**Verification:**
- Focused POS view-model/component tests pass.
- Shared status and server register-session tests pass.
- Relevant broader validation either passes or any unrelated blocker is documented precisely.
- Graphify output is rebuilt after code changes.

---

## System-Wide Impact

- **Interaction graph:** POS register state flows through the view model into `RegisterDrawerGate`; Cash Controls remains the closeout owner for `closing` sessions.
- **Error propagation:** Known `closing` state should be stopped before command submission. Direct or stale command attempts still return safe `CommandResult` conflict errors.
- **State lifecycle risks:** `closing` remains closeout-only until transitioned to `closed`; POS does not create a replacement drawer in the interim.
- **API surface parity:** No public Convex function or DTO status union changes are required; the browser view-model state shape changes internally.
- **Integration coverage:** View-model tests prove command suppression; component tests prove the cashier cannot submit open-drawer from the closeout-blocked gate.
- **Unchanged invariants:** Register-session transitions remain `open -> active/closing`, `active -> closing`, and `closing -> closed`.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The UI hides the open-drawer form for states other than `closing` | Keep `closing` detection explicit and preserve missing-drawer tests for `null` active register session |
| A stale client still submits `openDrawer` | Preserve server conflict mapping and inline drawer-gate error handling |
| Closeout-blocked copy could imply the cashier can close from POS | Keep the next action as Cash Controls and avoid adding POS closeout behavior |
| Existing POS recovery loses draft state | Retain existing recovery tests for active POS sessions and no start/bind/open-drawer calls in `closing` state |

---

## Documentation / Operational Notes

- If implementation uncovers a new reusable nuance, update `docs/solutions/logic-errors/athena-pos-drawer-invariants-at-command-boundaries-2026-04-24.md` to mention that known `closing` drawers need a closeout-blocked UI state, not just command-boundary validation.
- The operator-facing behavior should be simple: finish the closeout in Cash Controls, then return to POS to open or use a POS-usable drawer.

---

## Sources & References

- Related Linear issue: V26-379
- Related learning: `docs/solutions/logic-errors/athena-pos-drawer-invariants-at-command-boundaries-2026-04-24.md`
- Related code: `packages/athena-webapp/shared/registerSessionStatus.ts`
- Related code: `packages/athena-webapp/convex/operations/registerSessions.ts`
- Related code: `packages/athena-webapp/convex/pos/application/commands/register.ts`
- Related code: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Related code: `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`
- Related code: `packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx`

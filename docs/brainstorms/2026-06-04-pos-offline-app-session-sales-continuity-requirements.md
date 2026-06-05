---
date: 2026-06-04
topic: pos-offline-app-session-sales-continuity
---

# POS Offline App-Session Sales Continuity

## Summary

Athena should let returning provisioned POS terminals keep starting and completing sales during total network loss even when the app-level session is missing or stale. App-session uncertainty and other cloud-dependent sale blockers should become internal reconciliation conditions, while the cashier's normal local checkout flow continues from trusted local POS authority.

---

## Problem Frame

Field POS terminals cannot assume stable internet. A terminal can be provisioned, locally ready, and staffed for checkout, then lose the app-level Athena session while the network is unavailable. If the register responds by requiring app sign-in before a cashier can finish or start a sale, checkout stops for a reason the operator cannot fix in the field.

Athena already treats POS as a local-first workflow in several areas: terminal setup, local staff authority, drawer/register state, catalog/readiness snapshots, and local event recording. The remaining product gap is not whether a brand-new user can authenticate offline. The gap is whether a known POS terminal keeps operating when cloud session validation is temporarily unreachable.

---

## Actors

- A1. Cashier: Uses the provisioned register to start and complete sales during the selling day.
- A2. Store manager or support operator: Reviews reconciliation items after connectivity returns when cloud validation cannot accept local history cleanly.
- A3. Athena POS terminal: The provisioned browser/device that holds local POS authority, records local events, and syncs when online.
- A4. Athena cloud: The online authority for app sessions, terminal status, staff proof validation, sync acceptance, reporting, and review workflows.

---

## Key Flows

- F1. Continue selling after app-session loss while offline
  - **Trigger:** A returning provisioned terminal opens or reloads POS with no network, and the app-level session is missing, stale, or cannot be validated.
  - **Actors:** A1, A3
  - **Steps:** POS boots from local terminal state, restores local register context, allows local cashier sign-in when needed, and lets the cashier start or continue checkout without requiring app sign-in.
  - **Outcome:** Checkout continues locally, and app-session uncertainty is preserved for later reconciliation instead of blocking the cashier.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8

- F2. Complete active checkout during network loss
  - **Trigger:** A cashier is in the middle of a cart, payment, or sale completion flow when app-session validation is unavailable.
  - **Actors:** A1, A3
  - **Steps:** POS keeps the active sale usable, records cart/payment/completion activity locally, and returns the cashier to the normal register workflow after completion.
  - **Outcome:** The customer interaction completes without waiting for network restoration.
  - **Covered by:** R3, R4, R7, R8, R9, R10

- F3. Audit and convert field-unsafe sale blockers
  - **Trigger:** Planning or implementation reviews the known states that currently prevent POS sales.
  - **Actors:** A2, A3, A4
  - **Steps:** Each blocker is classified as a local impossibility, locally known safety failure, or cloud-validation uncertainty. Field-unsafe blockers caused by unavailable cloud validation are converted into internal review or reconciliation items.
  - **Outcome:** The register blocks only when local sale recording cannot be trusted or cannot be performed.
  - **Covered by:** R11, R12, R13, R14, R15, R16

- F4. Reconcile after connectivity returns
  - **Trigger:** The terminal regains usable network access after app-session-unverified offline selling.
  - **Actors:** A2, A3, A4
  - **Steps:** Athena validates app-session, terminal, drawer, staff, and sync evidence, accepts clean local events, and routes unresolved mismatches to manager or support review without hiding completed local sales.
  - **Outcome:** Clean local sales become cloud-visible, and unresolved issues have enough context for reconciliation.
  - **Covered by:** R17, R18, R19, R20, R21

---

## Requirements

**Offline Sales Continuity**
- R1. A returning provisioned POS terminal must not require fresh app sign-in to enter POS when the network is unavailable.
- R2. A missing, stale, or unvalidated app-level session during total network loss must not block POS route entry for a returning provisioned terminal.
- R3. A missing, stale, or unvalidated app-level session during total network loss must not block starting a new local sale when local POS authority is otherwise sufficient.
- R4. A missing, stale, or unvalidated app-level session during total network loss must not block completing an active local cart, payment, or sale when local POS authority is otherwise sufficient.
- R5. POS continuity must apply only to POS surfaces needed for register operation, not to generic Athena app access.
- R6. POS continuity must use the terminal's existing local authority rather than treating app-session recovery as sale authority.

**Local Sale Authority**
- R7. Local sale continuation must require enough local state to identify the provisioned terminal, store, register context, cashier authority, and durable local event destination.
- R8. Cashier-facing checkout should proceed through the normal POS workflow when local sale authority is sufficient, without presenting review or reconciliation as a normal-flow task.
- R9. Local sale actions must be durably recorded before being presented as completed to the cashier.
- R10. Locally recorded sales must preserve enough staff, terminal, register, sale, payment, and timing context for later sync and review.

**Blocker Audit**
- R11. The implementation plan must audit every known POS state that can prevent sale-affecting local actions in the field.
- R12. The blocker audit must include app-session state, terminal state, drawer/register state, cashier/staff authority, catalog/readiness state, sync state, pending review state, stale cloud state, and command preconditions.
- R13. Each blocker must be classified as one of: local recording impossible, locally known unsafe, or cloud-validation uncertainty.
- R14. Cloud-validation uncertainty must default to local sale continuation plus internal reconciliation when local recording and local sale authority are available.
- R15. Hard sale blockers must be retained only when local sale recording is impossible or locally known to be unsafe.
- R16. Every retained hard blocker must have an explicit product justification and an operator-safe recovery path.

**Reconciliation**
- R17. App-session uncertainty during offline POS use must be captured as internal audit or reconciliation context on local history, not as a cashier workflow interruption.
- R18. When connectivity returns, Athena must validate locally recorded sale history against current app-session, terminal, drawer, staff, and sync authority rules.
- R19. Cleanly accepted local sale history must sync into normal cloud POS, transaction, payment, inventory, cash-control, and trace surfaces.
- R20. Local sale history that cannot be accepted cleanly must become manager or support review work with enough context to reconcile.
- R21. Reconciliation must preserve completed local sales and their evidence rather than silently deleting or rewriting cashier-recorded history.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5.** Given a provisioned terminal previously loaded POS and later loses network, when the app-level session is missing on reload, POS opens the register surface instead of sending the cashier to a sign-in dead end.
- AE2. **Covers R3, R6, R7, R8.** Given the terminal has local terminal setup, local cashier authority, register context, and a writable local event store, when the cashier starts a new sale offline with no app session, POS allows the sale to proceed through the normal register workflow.
- AE3. **Covers R4, R9, R10.** Given a cart is already active when app-session validation becomes unavailable, when the cashier records payment and completes the sale offline, POS durably records the completion and preserves enough context for later sync.
- AE4. **Covers R11, R12, R13, R14, R15, R16.** Given a current sale blocker depends on live cloud validation, when the blocker audit classifies it as cloud-validation uncertainty and local authority is otherwise available, the blocker is converted into review/reconciliation behavior instead of stopping sales.
- AE5. **Covers R15, R16.** Given the terminal has no local event destination or cannot identify the provisioned terminal, when the cashier tries to sell offline, POS may hard block because the sale cannot be durably or safely recorded locally.
- AE6. **Covers R17, R18, R19.** Given sales were completed offline while the app session was missing, when the terminal reconnects and cloud validation accepts the terminal, staff, drawer, and event evidence, the sales sync into normal Athena records.
- AE7. **Covers R20, R21.** Given offline sales were completed and later cloud validation finds a terminal, drawer, staff, or sync mismatch, when reconciliation runs, Athena preserves the completed local history and creates review work with enough context for managers or support to resolve it.

---

## Success Criteria

- Returning provisioned POS terminals can continue starting and completing sales locally during total network loss.
- Cashiers do not need to understand app-session recovery, sync review, or reconciliation housekeeping to keep serving customers.
- Product and engineering can point to an explicit audit of every known sale blocker and why each one continues, becomes review, or remains a hard stop.
- Manager or support review receives enough context to reconcile app-session, terminal, drawer, staff, payment, inventory, and sync mismatches after connectivity returns.
- Downstream planning can proceed without inventing the product stance on app-session absence, new-sale behavior, active-sale completion, or blocker conversion.

---

## Scope Boundaries

- Fresh app login while offline is out of scope.
- Fresh POS recovery-code verification while offline is out of scope.
- First-time terminal provisioning while offline is out of scope.
- Terminal repair while offline is out of scope unless the repair can be completed entirely from already trusted local state.
- Broad offline access to non-POS Athena routes is out of scope.
- Offline manager approval for protected manager-only commands is out of scope unless planned separately.
- Exact local storage structures, sync event formats, route-gate implementation, and review-surface design belong to planning.

---

## Key Decisions

- Continue sales by default: Field checkout should not stop because cloud validation is temporarily unreachable.
- App-session absence is not sale authority: POS sale authority remains grounded in local terminal, staff, drawer/register, readiness, and command evidence.
- Reconciliation over interruption: Cloud uncertainty should create internal review work after the fact, not normal-flow cashier friction.
- Audit blockers explicitly: The implementation must not fix only the known app-session symptom while leaving other field-unsafe blockers in place.
- Hard blockers need justification: Blocking checkout is acceptable only when local recording cannot happen or local evidence already proves the sale would be unsafe.
- POS-only scope: The continuity promise is for register operation, not a general offline Athena app session.

---

## Dependencies / Assumptions

- The terminal was previously provisioned online for the same store before offline operation begins.
- The terminal has previously loaded enough POS app shell and local business state to mount the register without network.
- Local staff authority exists for at least one eligible cashier or manager if cashier sign-in is required.
- Local command recording is durable enough to preserve sale history until sync or review.
- Existing POS review and reconciliation surfaces can be extended or adapted during planning.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R11, R12, R13][Technical] Inventory all current sale-affecting blockers and classify each into local recording impossible, locally known unsafe, or cloud-validation uncertainty.
- [Affects R14, R17, R20][Technical] Decide how app-session-unverified local history is represented in sync/reconciliation without surfacing normal-flow warnings to cashiers.
- [Affects R15, R16][Technical] Define the exact retained hard-block list and the operator-safe recovery path for each retained blocker.
- [Affects R18, R19, R20, R21][Technical] Define the reconciliation behavior for terminal, drawer, staff, payment, inventory, and sync mismatches after network returns.

---

## Next Steps

-> /ce-plan for structured implementation planning

---
date: 2026-05-13
topic: pos-local-first-register
---

# POS Local-First Register

## Summary

Athena should make POS an offline-first register for already-provisioned businesses. Terminals are set up online, then the POS workflow runs from durable local state by default, supports checkout across all payment methods while disconnected, and syncs the complete register timeline back to Athena for cash-controls, inventory, transaction, payment, and workflow-trace reconciliation.

---

## Problem Frame

Athena's target operators work in environments where internet access is not reliable enough to be a dependency during checkout. If the register waits on live backend availability, the store's most time-sensitive workflow becomes fragile at exactly the moment a customer is ready to pay.

The business itself is still claimed and managed online. The offline requirement is narrower: after a terminal has been provisioned for an existing store, the POS workflow should remain usable during connection loss without turning every Athena workspace into a distributed offline system.

Existing POS architecture already distinguishes the cart/sale workflow from the drawer shift ledger. The local-first register design needs to preserve that business distinction while changing where POS actions are first recorded.

---

## Actors

- A1. Cashier: Opens and uses the register, completes sales, records payments, issues receipts, and closes out the drawer during the selling day.
- A2. Store manager: Reviews synced sales, payment exceptions, stock exceptions, and closeout reconciliation after the register reconnects.
- A3. Athena POS terminal: The provisioned browser/device that stores local POS state, records local events, and syncs them when online.
- A4. Athena cloud: The online system of record for store data, cash controls, inventory, transactions, payment allocations, workflow traces, staff, and reporting.

---

## Key Flows

- F1. Provision a POS terminal for offline use
  - **Trigger:** A business has already been claimed online and wants a device to run POS in unreliable network conditions.
  - **Actors:** A2, A3, A4
  - **Steps:** The manager registers the device to the existing business and store. Athena grants the terminal its store identity, terminal identity, offline POS permission set, staff sign-in material, register configuration, catalog seed, price rules, tax rules, and latest known inventory snapshot. The terminal confirms that POS can boot from local data after provisioning.
  - **Outcome:** The terminal can run POS locally even if the next session starts without internet.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Operate the register while offline
  - **Trigger:** A cashier opens POS while the connection is absent, slow, or unstable.
  - **Actors:** A1, A3
  - **Steps:** POS boots from local state, lets the cashier authenticate locally, opens or resumes the local register session, searches the local catalog, records cart changes, accepts checkout, records receipts, and shows sync status without blocking the sale on cloud availability.
  - **Outcome:** The cashier can keep selling, and every POS action is durably recorded on the terminal for later sync.
  - **Covered by:** R6, R7, R8, R9, R10, R11, R12, R13

- F3. Complete checkout with any payment method offline
  - **Trigger:** A customer pays while the terminal is offline or cannot reliably reach Athena.
  - **Actors:** A1, A3
  - **Steps:** The cashier records one or more payments using cash, card, mobile money, or another configured POS payment method. POS records the same payment method and amount data used by the existing checkout flow, then completes the local sale and produces a receipt with a permanent local receipt number.
  - **Outcome:** The customer can complete checkout without Athena adding extra payment-confirmation steps that do not exist in the current POS flow.
  - **Covered by:** R14, R15, R16, R17, R18

- F4. Finalize a local closeout before sync
  - **Trigger:** The cashier needs to end the register session while unsynced POS events still exist.
  - **Actors:** A1, A3
  - **Steps:** The cashier counts cash, records closeout notes, and finalizes the local closeout. POS pauses selling for that local register session, preserves the complete local timeline, and supports the existing reopen-for-correction path where permitted before later selling continues on that register session.
  - **Outcome:** The operator can end the day offline without losing accounting state, while Athena cloud still treats the closeout as pending reconciliation until sync succeeds.
  - **Covered by:** R19, R20, R21, R22, R23

- F5. Sync and reconcile local POS history
  - **Trigger:** The terminal regains a usable connection.
  - **Actors:** A2, A3, A4
  - **Steps:** The terminal uploads local POS events in order. Athena accepts idempotent events, maps local records to cloud records, updates cash controls, transactions, payment allocations, inventory, and workflow traces, and surfaces conflicts for manager review.
  - **Outcome:** Clean register history becomes cloud-visible, while exceptions are routed to review instead of silently failing or blocking already-completed customer interactions.
  - **Covered by:** R24, R25, R26, R27, R28, R29, R30

---

## Requirements

**Provisioning and Scope**
- R1. Offline-first POS must be available only for terminals provisioned online into an existing claimed Athena business and store.
- R2. Terminal provisioning must give POS enough local state to boot and sell without depending on live backend subscriptions at runtime.
- R3. POS must be the only Athena workflow with the default offline-first operating contract in this release.
- R4. Non-POS workspaces may show unavailable, stale, or read-only states while offline rather than adopting POS's local-first behavior.
- R5. Offline POS access must honor the terminal, staff, store, and permission context known at the last successful provisioning or sync.

**Local Register Operation**
- R6. POS must load from local state first every time, even when a network connection exists.
- R7. POS must support local staff authentication suitable for register operation after provisioning.
- R8. POS must support local daily/register opening, cart building, catalog search, checkout, receipt generation, void/refund actions where permitted, cash movement recording, and closeout.
- R9. POS must record each register action durably before presenting it as completed to the cashier.
- R10. POS must make sync state visible without framing offline operation as a broken or degraded mode.
- R11. POS must preserve local register session identity before any cloud register-session id exists for that session.
- R12. POS must preserve local POS session and transaction identity before any cloud transaction id exists.
- R13. Local receipt numbers must remain permanent and searchable after cloud sync.

**Offline Payments**
- R14. Offline checkout must support all configured POS payment methods, including cash, card, mobile money, and mixed payments.
- R15. Each offline payment must preserve the same payment method, amount, timestamp, and staff context expected by the existing POS checkout flow.
- R16. Cash payments must be treated as locally collected when the cashier records them.
- R17. Non-cash payment methods must not introduce new cashier confirmation states solely because the terminal is offline.
- R18. Payment reconciliation must preserve the existing POS payment model unless a later requirements document explicitly changes payment-provider behavior.

**Local Closeout**
- R19. POS must allow final local closeout while unsynced POS events exist.
- R20. Final local closeout must pause additional sales on the local register session unless the session is reopened through the existing permitted correction path.
- R21. After final local closeout, POS must support reopening the same local register session where the current register workflow allows it, and must record that reopen as part of the local timeline before new sales continue.
- R22. A locally closed register session must retain the complete local timeline required for cloud cash-controls reconciliation.
- R23. Athena cloud must treat locally closed but unsynced register sessions as pending reconciliation until the full event history is accepted.

**Sync and Reconciliation**
- R24. POS sync must upload local register events in a stable order that preserves the cashier's register timeline.
- R25. Sync must be idempotent so retrying after network loss does not duplicate sales, payments, receipts, cash movements, or closeouts.
- R26. Athena must map local register sessions, POS sessions, transactions, payments, receipts, and closeouts to cloud records after sync.
- R27. Synced POS facts must feed Athena cash-controls, inventory, transaction history, payment allocation, and workflow trace surfaces.
- R28. Inventory conflicts must be surfaced as manager review work rather than silently changing the cashier's completed sale.
- R29. Payment record conflicts must be surfaced as manager review work with enough context to resolve them.
- R30. Permission drift between the terminal's last synced state and current cloud policy must be surfaced for review without rewriting already-recorded local history.

**Operator Experience**
- R31. Cashiers must be able to tell whether the terminal is synced, syncing, offline, or has reconciliation exceptions.
- R32. Cashiers must be able to continue normal checkout flows without waiting on sync when POS has local authority to act.
- R33. Manager-facing reconciliation must separate normal pending sync from conflicts that require human action.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R6.** Given a terminal was provisioned online yesterday, when the cashier opens POS today with no connection, POS boots from local state and allows register operation without waiting for Athena cloud.
- AE2. **Covers R3, R4.** Given the terminal is offline, when the operator opens analytics or procurement, Athena may show an offline/stale state while POS remains locally usable.
- AE3. **Covers R8, R9, R10.** Given the connection drops during checkout, when the cashier adds items and completes the sale, POS records the actions locally, shows the sale as pending sync, and does not expose raw network failure as the sale outcome.
- AE4. **Covers R14, R15, R17, R18.** Given a customer pays with mobile money while the terminal is offline, when the cashier records the payment through the normal POS payment flow, the sale can complete locally without an extra offline-only confirmation step.
- AE5. **Covers R14, R16.** Given a customer pays with cash while offline, when the cashier records the cash payment, the payment is treated as locally collected and included in the local drawer totals.
- AE6. **Covers R19, R20, R21, R22, R23.** Given the register has unsynced sales at the end of the day, when the cashier finalizes local closeout, POS pauses selling, preserves the timeline, and allows the existing permitted reopen-for-correction path to append a local reopen event before later sales continue.
- AE7. **Covers R24, R25, R26, R27.** Given a terminal reconnects after offline selling and closeout, when sync runs twice because the connection drops during upload, Athena accepts each local event once and updates cloud cash-controls, transaction, inventory, payment, and trace records without duplicates.
- AE8. **Covers R28, R33.** Given two terminals sold the same last unit while disconnected, when both sync, Athena keeps the completed local sales visible and routes the stock conflict to manager reconciliation.
- AE9. **Covers R29, R33.** Given a synced offline sale contains a malformed or conflicting payment record, when Athena reconciles the register history, Athena surfaces the conflict for manager review rather than hiding the sale.
- AE10. **Covers R13.** Given a customer returns with a receipt printed during offline checkout, when the store searches after sync, Athena can find the transaction by the original local receipt number.

---

## Success Criteria

- Cashiers can complete a normal selling day through POS despite unreliable internet.
- POS feels like a usable register while offline, with sync status visible but not disruptive to ordinary checkout.
- Store managers can distinguish pending sync from true reconciliation exceptions.
- Cloud cash-controls and reporting catch up from local register history without losing local closeout or receipt context.
- Inventory and payment conflicts are reviewable with enough business context to resolve them.
- Downstream planning can proceed without inventing the product boundary, payment policy, closeout behavior, or conflict ownership model.

---

## Scope Boundaries

- Offline-first behavior for inventory management, procurement, analytics, staff management, admin, and cash-controls review is out of scope for this release.
- Brand-new business creation with no prior online claim is out of scope.
- Cross-device peer-to-peer sync while all devices are offline is out of scope.
- Real-time multi-terminal stock coordination while offline is out of scope.
- Exact local storage technology, event format, sync transport, and retry algorithm belong to planning.
- Payment-provider-specific offline authorization behavior is out of scope unless a later requirements document changes the POS payment model.
- Automatic conflict resolution for inventory or payment exceptions is out of scope; the first release should route conflicts to manager review.
- Marketing, loyalty, and customer communication changes are out of scope unless required for receipt continuity.

---

## Key Decisions

- POS-only offline-first scope: Keeps the reliability promise focused on the workflow that must keep running in the field.
- Online provisioning required: Avoids cold-start identity, business-claim, and permission problems while still supporting unreliable runtime connectivity.
- Local state first: The register should not depend on live backend subscriptions for boot or sale flow readiness.
- Local event history as the operational record: Every POS action needs durable local evidence before it can be synced into Athena's cloud records.
- All payment methods allowed offline: The register should preserve the cashier's actual tender flow without adding offline-only payment confirmation complexity.
- Local final closeout allowed: Operators can end the business day offline because the terminal saves the complete register state locally.
- Closeout pauses local selling: A locally closed register session must not keep accepting sales that would later distort the counted drawer unless the register is reopened through the existing correction workflow and that reopen is recorded locally.
- Reconciliation over rollback: Once a cashier completes a local customer interaction, later conflicts should become manager work rather than hidden sale rewrites.
- Permanent local receipt numbers: Customer-facing proof issued offline must remain useful after cloud sync.

---

## Dependencies / Assumptions

- The POS terminal has already been provisioned online for an existing Athena business and store before offline operation begins.
- Staff and permission state can be cached locally in a form suitable for POS operation between syncs.
- Product catalog, prices, taxes, and last-known inventory can be represented locally well enough for checkout.
- Existing POS concepts such as register sessions, POS sessions, transactions, payment allocations, inventory movements, and workflow traces remain the cloud-side business records after sync.
- Offline payments should follow the current POS payment semantics; any future provider-specific authorization behavior should be scoped separately.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R2, R6, R9][Technical] Decide the local persistence and durability strategy for POS boot state and event history.
- [Affects R14, R15, R17][Technical] Confirm the current POS payment method set and ensure offline checkout preserves the same payment semantics.
- [Affects R24, R25, R26][Technical] Define the sync ordering, idempotency, and local-to-cloud identity mapping model.
- [Affects R28, R29, R30, R33][Technical] Define the first manager reconciliation surface for inventory, payment, and permission exceptions.
- [Affects R13][Technical] Define the local receipt number format and cloud search behavior.

---

## Alternatives Considered

- Offline selling with online-only final closeout: Simpler cloud accounting, but it fails the field need when operators must end the day without reliable internet.
- Offline cart and cash-only checkout: Lower implementation risk, but too weak for the target workflow because it excludes normal tender behavior and still leaves day-end operations fragile.
- Full offline Athena across every workspace: More comprehensive, but it turns the whole product into a distributed offline system before the POS reliability problem is proven and bounded.

---

## Next Steps

-> /ce-plan for structured implementation planning

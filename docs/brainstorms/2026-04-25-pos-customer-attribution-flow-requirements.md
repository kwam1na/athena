---
date: 2026-04-25
topic: pos-customer-attribution-flow
---

# POS Customer Attribution Flow

## Problem Frame

Cashiers need a fast, low-friction way to attach a customer to an active POS sale without leaving the register workflow. The current customer panel supports lookup and creation, but it reads as a form-heavy side task rather than a quiet register control. The refined flow should make customer attribution feel like part of every sale: visible, optional, reversible, and quick enough to use during checkout pressure.

---

## Actors

- A1. Cashier: Runs the active POS sale and decides whether to attribute it to a known or new customer.
- A2. Customer: Provides name, phone, or email when attribution is useful.
- A3. Store operator: Reviews transaction history and customer activity after the sale.

---

## Key Flows

- F1. Lookup and link an existing customer profile
  - **Trigger:** The cashier opens the customer strip during an active sale.
  - **Actors:** A1, A2
  - **Steps:** The strip expands into search. The cashier searches by name, phone, or email. Matching customer profiles appear as scannable rows, including identities linked from POS customers, storefront users, or guests when available. The cashier selects one result.
  - **Outcome:** The active sale is attributed to the selected customer profile and the strip collapses into a compact customer summary.
  - **Covered by:** R1, R2, R3, R6

- F2. Add a new customer from lookup
  - **Trigger:** The cashier searches and no suitable customer is found.
  - **Actors:** A1, A2
  - **Steps:** The flow offers an add action seeded from the search text. The cashier fills the minimum useful details. Phone or email creates or resolves the reusable customer profile, backed by the POS customer/source record needed by the existing register flow; name-only attribution stays sale-only.
  - **Outcome:** The active sale is attributed to the resolved customer profile when identity is strong enough, with persistence determined by the captured identity strength.
  - **Covered by:** R1, R4, R5, R6

- F3. Change or clear attribution
  - **Trigger:** The active sale already has a customer attached.
  - **Actors:** A1
  - **Steps:** The strip shows the selected customer summary. The cashier can change the customer, edit the current attribution details, or clear attribution back to walk-in.
  - **Outcome:** Attribution updates without disrupting cart or payment state.
  - **Covered by:** R3, R7, R8

---

## Requirements

**Register Placement**
- R1. The register should show customer attribution as a persistent compact strip above the main workspace while a sale is active.
- R2. The default state should clearly communicate that the sale is for a walk-in customer and expose one obvious action to find or add a customer.
- R3. When a customer is selected, the strip should collapse into a calm summary showing the customer name and one secondary identifier when available.

**Lookup-First Flow**
- R4. The expanded state should optimize for lookup first, supporting search by name, phone, or email.
- R5. If no suitable match appears, the flow should offer adding a customer seeded from the cashier's search text.
- R6. Selecting or adding a customer should attribute the active sale immediately and return the cashier to the compact register view.

**Attribution Semantics**
- R7. The flow should support clearing attribution back to walk-in without changing cart contents, payments, or cashier/session state.
- R8. The flow should support changing the attached customer during the sale.
- R9. `customerProfile` is the canonical customer identity for cross-channel attribution. POS customer records, storefront users, and guests are source records that should link into a customer profile when they are selected or created.
- R12. Adding with phone or email should create or resolve a reusable customer profile; name-only attribution should remain sale-only unless the cashier provides stronger identity.

**Design Quality**
- R10. The UI should follow the same restrained POS shell language: compact controls, clear hierarchy, low chrome, stable layout, and no form-heavy panel dominating the workspace.
- R11. Error and empty states should use calm operator-facing copy and avoid raw backend wording.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R4.** Given an active sale with no customer attached, when the cashier opens the customer strip, the first interaction is lookup by name, phone, or email.
- AE2. **Covers R3, R6, R9.** Given search results include an existing customer profile, when the cashier selects that customer, the sale is attributed and the strip returns to a compact selected-customer state.
- AE3. **Covers R5, R12.** Given no search result matches and the cashier enters only a name, when they add attribution, the sale carries the name but does not create a reusable customer profile.
- AE4. **Covers R5, R9, R12.** Given no search result matches and the cashier enters a phone or email, when they add the customer, the sale is attributed to a reusable customer profile.
- AE5. **Covers R7.** Given a customer is attached, when the cashier clears attribution, the sale returns to walk-in while cart and payment state remain unchanged.

---

## Success Criteria

- Cashiers can attach, add, change, or clear a customer without leaving the active register flow.
- Existing cross-channel customer profiles are easier to reuse than duplicate.
- New customer creation is fast but does not force weak name-only records into the customer profile system.
- The next implementation plan can execute the workflow without inventing product behavior or placement.

---

## Scope Boundaries

- Loyalty prompts, rewards enrollment, and marketing consent are out of scope for this iteration.
- Customer deduplication or merge workflows are out of scope beyond lookup-first duplicate prevention and existing email/phone profile resolution.
- Dedicated storefront account-management UI is out of scope, but POS attribution should use existing storefront user/guest matches when the codebase can resolve them through customer profiles.
- Post-sale customer reassignment is out of scope; this flow is for active sales.
- The flow should not require customer attribution before checkout.

---

## Key Decisions

- Persistent strip over modal-first entry: Keeps attribution visible without interrupting product lookup or checkout.
- Lookup-first over add-first: Reduces duplicate records and matches cashier behavior for returning customers.
- Customer profile as the canonical identity: POS customers, storefront users, and guests can all describe the same person, but the register attribution flow should attach to the unified customer profile concept.
- Hybrid persistence: Phone/email creates or resolves reusable identity; name-only stays sale-only to avoid low-quality customer records.

---

## Dependencies / Assumptions

- Existing POS customer lookup, create/update, storefront user/guest matching, customer profile linking, and session customer snapshot capabilities are available in the codebase.
- Existing POS session tracing already records customer linked, updated, and cleared stages.
- The refined UI should reuse the active register shell rather than introduce a separate customer management surface.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R5, R9][Technical] Determine the safest parsing behavior for search text when seeding add fields from a name, phone, or email.
- [Affects R10][Technical] Decide whether to adapt the current customer panel or replace it with a focused register-specific component.

---

## Next Steps

-> /ce-plan for structured implementation planning

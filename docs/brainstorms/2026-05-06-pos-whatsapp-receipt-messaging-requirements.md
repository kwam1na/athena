---
date: 2026-05-06
topic: pos-whatsapp-receipt-messaging
---

# POS WhatsApp Receipt Messaging

## Summary

Athena should let operators send a POS transaction receipt link to a customer through WhatsApp Business, starting with receipt-only transactional messaging. The first release should stay narrow while introducing a small customer-message foundation that can later support order updates, service notifications, reminders, and payment links through explicit message intents and channel policy.

---

## Problem Frame

Customers often want a digital receipt after an in-store POS sale, especially when the sale needs to be referenced later for returns, warranty questions, customer-history review, or service follow-up. Athena already records completed POS transactions and has customer-facing receipt presentation, but the operator still needs a direct way to deliver that receipt to the customer at checkout or after the fact.

This sits next to a larger customer communication surface. Receipts are transactional and low-risk when sent deliberately, but WhatsApp can also become a support, marketing, order-update, and service-reminder channel. If the receipt feature is built as a POS-only shortcut, future messaging use cases will likely duplicate policy, templates, delivery tracking, and consent handling. If the first release tries to become a full messaging platform, it will carry too much product and operational complexity before the receipt workflow proves itself.

---

## Actors

- A1. Cashier: Completes POS sales and sends a receipt link when the customer wants one.
- A2. Store operator or manager: Reviews completed transactions and receipt delivery history after checkout.
- A3. Customer: Receives a WhatsApp message and opens the receipt link.
- A4. Athena: Resolves the transaction, recipient, message intent, delivery policy, receipt link, and delivery status.
- A5. WhatsApp Business provider: Sends the approved business message and reports delivery outcomes.

---

## Key Flows

- F1. Send receipt immediately after sale completion
  - **Trigger:** A POS sale completes and the customer asks for a WhatsApp receipt.
  - **Actors:** A1, A3, A4, A5
  - **Steps:** Athena exposes a receipt-send action in the completed sale state. The cashier confirms the prefilled phone number or enters a one-time WhatsApp number. Athena prepares a customer-safe receipt link, sends the WhatsApp receipt message, and records the delivery attempt.
  - **Outcome:** The customer receives a receipt link when delivery succeeds, and Athena shows the attempt state to the cashier.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R9, R10, R11

- F2. Send or resend from transaction detail
  - **Trigger:** A store operator opens a completed transaction after checkout.
  - **Actors:** A2, A3, A4, A5
  - **Steps:** Athena shows prior receipt delivery attempts and exposes a send or resend action. The operator confirms the recipient number, sends the receipt, and can see whether the latest attempt is pending, sent, delivered, read, or failed when provider status is available.
  - **Outcome:** Operators can recover from missed or failed receipt delivery without reopening the sale.
  - **Covered by:** R1, R4, R6, R7, R8, R9, R10

- F3. Use a one-time recipient number
  - **Trigger:** The customer wants the receipt sent to a number that is not saved on the customer profile or transaction.
  - **Actors:** A1, A3, A4
  - **Steps:** The cashier enters the one-time number during the send flow. Athena uses it only for the delivery attempt and makes the one-time nature visible in receipt delivery history.
  - **Outcome:** The receipt can be sent quickly without silently changing customer identity data.
  - **Covered by:** R2, R3, R8, R12

- F4. Extend messaging with a future non-receipt use case
  - **Trigger:** Athena later adds a customer communication use case such as an order update, service-ready notice, appointment reminder, or payment request.
  - **Actors:** A2, A3, A4, A5
  - **Steps:** The new use case defines its message intent, allowed channels, required recipient rules, template requirements, consent or operator-action policy, and delivery visibility. It reuses the shared message-delivery concepts without inheriting receipt-specific permissions.
  - **Outcome:** Future communication expands through explicit policy rather than cloning receipt behavior or treating all POS phone numbers as general-purpose contacts.
  - **Covered by:** R13, R14, R15, R16, R17

---

## Requirements

**Receipt Sending**
- R1. Athena must support sending a POS transaction receipt link through WhatsApp Business for completed POS transactions.
- R2. The send flow must prefill the best available customer phone number when one exists and allow the operator to enter a one-time WhatsApp recipient number.
- R3. A one-time typed recipient number must be used only for that receipt delivery attempt unless the operator separately updates the customer record.
- R4. Receipt sending must be available from the sale-complete state and from completed transaction detail.
- R5. The first release must be manual operator-initiated sending, not automatic sending after every sale.
- R6. Athena must communicate the immediate result of a send attempt to the operator without exposing raw provider or backend wording.

**Receipt Link Safety**
- R7. Customer-facing receipt links sent through WhatsApp must use a customer-safe sharing contract rather than making the internal transaction identifier the durable public access mechanism.
- R8. Receipt delivery history must preserve enough context to answer which transaction was sent, which recipient was used, whether the recipient came from customer data or one-time entry, who initiated the send, and what the latest delivery state is.

**Delivery Visibility**
- R9. Athena must record receipt delivery attempts and show meaningful delivery states when provider information is available.
- R10. A failed receipt delivery must be visible enough for an operator to retry or choose a corrected recipient.
- R11. If provider status is delayed or unavailable, Athena must distinguish that from a confirmed failure.

**Customer Data Boundaries**
- R12. Receipt delivery must not silently create, merge, or update customer profile data from a one-time receipt number.
- R13. Receipt-specific messaging permission must not become permission for marketing, support, reminders, or other future message types.

**Future Messaging Foundation**
- R14. Customer messaging must be organized by explicit message intent, with POS receipt link as the first supported intent.
- R15. Each future message intent must define allowed channels, recipient rules, template needs, send trigger, and consent or operator-action policy.
- R16. Future message intents must be able to reuse common delivery tracking while keeping their own product and policy boundaries.
- R17. Marketing and broad customer outreach must remain separate from transactional receipt messaging unless a later requirements document explicitly scopes it.

**WhatsApp Business Fit**
- R18. WhatsApp receipt messages should be treated as transactional utility messages, not marketing messages.
- R19. The first release should expect provider-approved WhatsApp message templates where required by WhatsApp Business policy.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R4, R5.** Given a completed POS sale with a customer phone number, when the cashier chooses to send a WhatsApp receipt, Athena pre-fills the number and sends only after the cashier confirms.
- AE2. **Covers R2, R3, R8, R12.** Given a completed sale has no saved customer phone, when the cashier enters a one-time WhatsApp number and sends the receipt, the delivery attempt records that number without attaching it to the customer profile.
- AE3. **Covers R4, R8, R9, R10.** Given a customer calls later asking for a receipt, when an operator opens the completed transaction, Athena shows previous delivery attempts and supports sending or retrying the WhatsApp receipt.
- AE4. **Covers R7.** Given a customer receives the WhatsApp message, when they open the receipt link, the link uses a customer-safe sharing contract rather than exposing the internal transaction id as the durable access mechanism.
- AE5. **Covers R6, R10, R11.** Given the WhatsApp provider does not confirm delivery immediately, when the operator views the transaction, Athena shows a pending or unknown delivery state rather than treating it as either delivered or failed.
- AE6. **Covers R13, R14, R15, R16, R17.** Given Athena later adds service-ready WhatsApp notifications, when that work is planned, it defines a new message intent and policy instead of reusing receipt permission or receipt-specific copy.
- AE7. **Covers R18, R19.** Given WhatsApp requires a template for the receipt message, when Athena sends the receipt, the message uses a receipt-appropriate utility template rather than a marketing-style message.

---

## Success Criteria

- Cashiers can send a WhatsApp receipt link quickly after checkout without leaving the POS workflow.
- Store operators can send or retry a receipt from transaction detail with clear delivery history.
- Customers receive a usable receipt link without requiring a storefront account or manual copying by the operator.
- One-time receipt numbers do not pollute customer profile data.
- The first release does not accidentally create marketing or broad customer messaging consent.
- Future customer communication use cases can reuse the same intent and delivery concepts without planning from scratch.
- A downstream implementation plan can proceed without inventing product behavior, customer-data boundaries, or messaging policy.

---

## Scope Boundaries

- Automatic receipt sending is out of scope for the first release.
- Stored customer WhatsApp receipt preferences are deferred.
- SMS, email, and multi-channel fallback are out of scope for the first release.
- Two-way WhatsApp inbox, support handoff, and agent conversation management are out of scope.
- Marketing broadcasts, promotions, and campaign messaging are out of scope.
- Customer profile merge, dedupe, and broad preference-center work are out of scope.
- PDF receipt generation and receipt attachments are out of scope; the first release should send a link.
- Provider selection, template operations, exact data model, webhook handling details, and route/API design belong to planning.

---

## Key Decisions

- Receipt-only first: Keeps the user-facing behavior focused while proving WhatsApp delivery in a low-risk transactional workflow.
- Manual operator action first: Avoids wrong-number, duplicate-send, and consent complexity before delivery tracking and preferences are proven.
- One-time number allowed: Supports real checkout behavior without forcing every receipt request into customer data management.
- No silent customer update: Protects customer identity quality and keeps receipt delivery distinct from profile maintenance.
- Customer-safe receipt sharing: A receipt link sent through WhatsApp should be designed for customer access, not rely on an internal transaction identifier as the durable public contract.
- Thin messaging foundation: Future use cases should add message intents and policies, not clone POS receipt delivery logic.
- Utility classification: Receipt links are transactional and should stay separate from marketing or broad outreach.

---

## Dependencies / Assumptions

- Completed POS transactions have enough customer and transaction context to generate receipt links and operator-facing delivery history.
- Customer profile phone number is the preferred source when available, with sale-only customer info as fallback.
- WhatsApp Business message rules may require approved templates for receipt messages depending on conversation context and provider setup.
- Provider delivery status may be asynchronous or incomplete, so Athena should support pending and unknown states.
- A later implementation plan will decide whether to start with Meta WhatsApp Cloud API directly or a business solution provider.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1, R18, R19][Needs research] Confirm the current WhatsApp Business template approval and utility-message requirements for the chosen provider path.
- [Affects R7][Technical] Decide the exact customer-safe receipt sharing mechanism and expiration or revocation behavior.
- [Affects R8, R9, R11][Technical] Decide which provider delivery states should be represented in Athena's operator-facing status model for the first release.
- [Affects R14, R15, R16][Technical] Define the smallest shared messaging foundation that supports receipt delivery now without becoming a full notification platform.

---

## Next Steps

-> /ce-plan for structured implementation planning

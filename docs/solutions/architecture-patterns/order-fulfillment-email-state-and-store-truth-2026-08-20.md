---
title: Order fulfillment emails preserve state and store truth
date: 2026-08-20
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: email_processing
resolution_type: code_fix
severity: high
applies_when:
  - Adding customer emails for online-order fulfillment transitions
  - Rendering pickup hours or store identity in order messages
  - Resolving paid orders by an external payment reference
tags: [order-email, fulfillment, store-schedule, payment-ownership, mailersend]
delivery_diff_fingerprint: 39532bd28e16984d391a218307c4c67eab37df07bcbe61e7aaed5b3c453b7ba8
---

# Order fulfillment emails preserve state and store truth

## Problem

Order updates crossed several authorities: order status, store identity, store schedule, payment ownership, and email rendering. Treating the email template as the whole feature left valid preview states unreachable, reused one send flag for two delivery milestones, and allowed paid-order messages to fall back to a global store name.

## Solution

Keep each source of truth at its owning boundary and pass a presentation-ready payload into the email renderer:

- schedule `ready-for-pickup`, `ready-for-delivery`, `out-for-delivery`, completion, and cancellation transitions from the order mutation;
- resolve the active Store Schedule only for pickup-ready mail and format weekly windows in `fulfillmentDetails.ts`;
- persist a distinct `didSendReadyForDeliveryEmail` marker so the later out-for-delivery message remains independently reachable;
- derive the store name and pickup location from the order's store for both payment-on-delivery and paid confirmations;
- resolve Paystack references through the owner-scoped internal order lookup; and
- keep lifecycle-specific React Email previews backed by the same production component.

## Why This Matters

An email preview proves presentation, not dispatch. The transition scheduler, send-suppression marker, store and schedule queries, and persisted result together form the delivery contract. Separating those concerns prevents a successful earlier transition from suppressing a later customer update, and prevents multi-store messages from mixing dynamic and hardcoded identity.

## Prevention

- Add a behavioral orchestration test whenever a new lifecycle preview or status branch is added.
- Assert both first-send and already-sent behavior for every persisted email marker.
- Test missing optional schedule data; pickup email delivery must continue without an hours table.
- Use Store Schedule for reusable store-local hours, never automation policy fields.
- Verify external payment references through an owner-scoped internal lookup before mutating an order.
- Regenerate Convex API, operation-admission caller tables, and Graphify artifacts after changing these call paths.

## Examples

The ready-for-delivery milestone records `didSendReadyForDeliveryEmail`; the subsequent out-for-delivery milestone continues to use `didSendReadyEmail`. Pickup-ready mail receives formatted weekly hours when a schedule exists and an empty hours list when it does not.

## Related

- [Athena Store Schedule owns reusable store-local business time](../architecture/athena-store-schedule-foundation-2026-06-27.md)

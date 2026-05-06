---
title: Athena POS Receipt Messaging Keeps Share Tokens And Delivery Attempts Separate From Customer Profiles
date: 2026-05-06
category: logic-errors
module: athena-webapp
problem_type: customer_data_boundary
component: pos
symptoms:
  - "Receipt delivery needs a customer-safe link but raw POS transaction ids are internal identifiers"
  - "One-time WhatsApp numbers can be mistaken for customer profile updates"
  - "Provider send status can leak raw external payloads into operator-facing transaction detail"
root_cause: messaging_audit_boundary_missing
resolution_type: design_pattern
severity: medium
tags:
  - pos
  - receipts
  - whatsapp
  - customer-messaging
  - convex
---

# Athena POS Receipt Messaging Keeps Share Tokens And Delivery Attempts Separate From Customer Profiles

## Problem

POS receipts need to be shareable outside Athena through WhatsApp, but a receipt link is not a customer identity update and a one-time recipient number is not reusable customer data. Sending the raw `posTransaction` id also exposes an internal identifier in a customer-facing URL.

## Solution

Use two separate records:

- `receiptShareToken` stores the public receipt access boundary and resolves a hashed token to one completed POS transaction.
- `customerMessageDelivery` stores each send attempt, recipient source, masked recipient display, provider id, status timestamps, actor, and safe failure summary.

The POS send command creates a fresh tokenized storefront URL, records the delivery attempt, sends the WhatsApp utility template, and updates the attempt from provider response/webhook status. One-time recipient numbers stay on the delivery attempt only; they must not patch `customerProfile` or transaction customer info.

## Prevention

- Future customer messaging intents should pass through explicit intent/channel policy instead of adding ad hoc send commands.
- Public receipt routes should resolve share tokens and use safe not-found responses for missing, expired, or revoked tokens.
- Browser DTOs may include delivery status summaries but should omit raw provider payloads and raw provider error bodies.
- Tests for receipt messaging should assert one-time-recipient isolation and tokenized storefront access, not only provider send success.

## Related Issues

- Linear: V26-488, V26-489, V26-490, V26-491, V26-492, V26-493, V26-494.

---
title: Athena POS Customer Attribution Uses Customer Profiles As The Canonical Identity
date: 2026-04-25
category: logic-errors
module: athena-webapp
problem_type: identity_model_drift
component: pos
symptoms:
  - "POS customer attribution can look complete while storefront history remains disconnected"
  - "Register sessions need a POS-compatible customer id even when the product concept is a cross-channel customer"
  - "Name-only customer entry can accidentally create low-quality reusable records"
root_cause: compatibility_identity_gap
resolution_type: code_fix
severity: medium
tags:
  - pos
  - customer-profile
  - storefront
  - compatibility
  - convex
---

# Athena POS Customer Attribution Uses Customer Profiles As The Canonical Identity

## Problem

Athena has several customer source records: `posCustomer`, `storeFrontUser`, and `guest`. POS register sessions historically store `customerId` as a `posCustomer` id, while storefront orders and service workflows converge around `customerProfile`. If POS attribution creates or selects only a POS customer, the sale can appear attributed in the register while cross-channel customer history stays split.

## Solution

Keep `customerProfile` as the canonical customer identity, and treat POS/customer source records as compatibility inputs:

- Selecting an existing POS customer should ensure or return its `customerProfile`.
- Selecting a storefront user or guest should create or reuse a POS source record only because the current POS session path still needs `customerId`.
- Reusable attribution should carry both ids where available: `customerId` for POS compatibility and `customerProfileId` for the canonical identity.
- Name-only attribution should stay sale-only and should not create either `posCustomer` or `customerProfile`.

## Prevention

- When changing POS customer flows, assert both compatibility and canonical identity behavior in tests.
- Thread `customerProfileId` through DTOs and session snapshots when the UI can receive it, even if an older mutation still requires `customerId`.
- Preserve trace and session update semantics when adding profile ids; customer linked, updated, and cleared stages should consider the profile id part of the attribution snapshot.
- Avoid broad customer merge work inside POS register tickets. Let lookup/link/create resolve obvious source matches, then leave dedupe UI for a dedicated workflow.

## Related Issues

- Linear: V26-390, V26-391, V26-392, V26-393.

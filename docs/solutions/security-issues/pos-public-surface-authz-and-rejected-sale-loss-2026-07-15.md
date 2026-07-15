---
title: "POS public surfaces need per-endpoint org authorization; rejected money-bearing sync events must leave a conflict"
date: 2026-07-15
category: security-issues
module: pos
problem_type: security_issue
component: authentication
symptoms:
  - "register.getState returned another tenant's terminal state, active cashier, open register session, and held cart contents with no authorization"
  - "openDrawer was authentication-only, so any org's user could open a drawer on a target store's terminal and corrupt cash-control attribution"
  - "All 13 convex/pos/public/customers.ts endpoints had zero authorization; getCustomerById leaked full PII by customerId and create/update were unauthenticated cross-tenant writes"
  - "A money-bearing offline sale rejected during sync advanced the cursor and wrote no conflict, so a cash sale vanished with the drawer left short"
root_cause: missing_permission
resolution_type: code_fix
severity: critical
tags: [pos, authorization, idor, pii, convex, sync-conflict, multi-tenant]
delivery_diff_fingerprint: 8b6b4a580e8c85e9379046eb27165d200676216c8479f2ae448228f7076b84fc
---

# POS public surfaces need per-endpoint org authorization; rejected money-bearing sync events must leave a conflict

## Problem

A POS local-first hardening audit found two active silent-failure classes at the seams around a sound event-sourcing core. First, several public Convex POS endpoints performed cross-tenant reads/writes with no authorization: `register.getState` (no auth at all), `register.openDrawer` (authentication only, no org check), and every endpoint in `convex/pos/public/customers.ts` (13 endpoints, PII reads plus cross-tenant writes). Second, a completed offline sale whose envelope/payload validation failed was marked `rejected`, advanced the sync cursor, and wrote no `posLocalSyncConflict` — money changed hands but the record silently disappeared.

## Symptoms

- `register.getState` returned a foreign store's terminal state, cashier, open register session, and held cart contents.
- `openDrawer` accepted any authenticated user from any org, corrupting cash-control attribution.
- `getCustomerById` returned full customer PII keyed only by `customerId`; `createCustomer`/`updateCustomer` were unauthenticated cross-tenant writes.
- A rejected money-bearing `sale_completed` event left no manager-visible record.

## What Didn't Work

- Presence-grep is insufficient for the sweep: a file can import `requireOrganizationMemberRoleWithCtx` yet still leave individual endpoints unguarded. The audit required a per-endpoint check, not a per-file one.
- For U2, a naive "retry the rejected event" is wrong — a validation-rejected financial event cannot be auto-corrected. It must surface as a `needs_review` conflict while the cursor still advances (liveness).

## Solution

Authorization (mirror the existing `requirePosTransactionStoreAccess` pattern in `convex/pos/public/transactions.ts`):

- `register.getState` (public wrapper `convex/pos/public/register.ts`): resolve the store from `storeId`, then `requireAuthenticatedAthenaUserWithCtx` → `requireOrganizationMemberRoleWithCtx(store.organizationId, ["full_admin","pos_only"])` before delegating. Return `null` for a missing store (no existence leak beyond the existing pattern).
- `openDrawer` (command `convex/pos/application/commands/register.ts`): add the same `requireOrganizationMemberRoleWithCtx` check right after the store is resolved and the user is authenticated.
- `customers.ts`: add two helpers — `requirePosCustomerStoreAccess({storeId})` and `requirePosCustomerAccessById({customerId})` (resolves the customer, then scopes to *its* store's org). Guard all 13 endpoints. `customerId`- and `storeFrontUserId`-keyed reads resolve the target's store first so a valid foreign id is still denied. The customer query/command application modules have no other callers, so the boundary is fully closed at the public surface.

Rejected-sale conflict (`convex/pos/application/sync/ingestLocalEvents.ts`):

- In the `rejected` branch, when the event is money-bearing (`sale_completed` with a non-empty `payments` array), create a `posLocalSyncConflict` with `conflictType: "server_rejected"` (`needs_review`) carrying `localEventId`, register session, `amount`, `localTransactionId`, and the rejection `reason` in `details`. The cursor still advances; non-financial rejects stay silent to avoid conflict spam.
- Add the `server_rejected` literal to the closed `conflictType` union in both the schema (`convex/schemas/pos/posLocalSyncConflict.ts`) and the type alias (`convex/pos/application/sync/types.ts`). This wires up the already-present-but-dead `server_rejected` branch in `classifyRegisterSessionSyncReview`, so the conflict reaches the manager review surface.

## Why This Works

The trust boundary for these operations is the public Convex wrapper (and the `openDrawer` command, which is the only caller of its logic). Enforcing org membership there — resolved from the store that owns the targeted resource — makes cross-tenant access impossible even with a valid foreign id, because membership is checked against the resource's own `organizationId`. For the rejected sale, routing money-bearing failures through the existing `posLocalSyncConflict` `needs_review` rail (with `createConflict`'s built-in dedup) guarantees exactly one durable, manager-visible artifact per rejected sale, idempotent on replay, without stalling the cursor.

## Prevention

- Sweep public Convex boundaries **per endpoint**, not per file. Auth-import presence is not proof of coverage.
- New POS public endpoints should resolve the store (directly, or via the resource they target) and call `requireOrganizationMemberRoleWithCtx` before any read/write — copy `requirePosTransactionStoreAccess`.
- Never let a money-bearing event leave the sync pipeline without either a canonical transaction or a `needs_review` conflict. Tests must assert cross-org denial (proving the underlying query/command is not called) and, for sync, that a rejected financial event creates exactly one conflict while the cursor advances.

## Related Issues

- Linear V26-1055 (register authz), V26-1056 (customers authz), V26-1057 (rejected-sale conflict).
- Plan: `docs/plans/2026-07-15-001-fix-pos-local-first-hardening-plan.md` (Phase 0, units U1/U11/U2).
- Deferred: POS `catalog.ts` search/barcode exposure → V26-956. `terminalAppSessions.ts` is a deliberate terminal-proof exception.

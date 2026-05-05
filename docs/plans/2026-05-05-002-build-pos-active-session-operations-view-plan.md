---
title: Build POS Active Session Operations View
date: 2026-05-05
status: active
type: feature
depth: standard
---

# Build POS Active Session Operations View

## Summary

Add an operator-facing POS sessions view that makes active and held checkout work visible, actionable, and auditable. The first version should let a manager see relevant session, cart, hold, operator, customer, drawer, expiry, and trace details, then expire a stale session and release its inventory holds without reaching into the register screen.

## Problem Frame

The POS register now uses ledger-backed inventory holds. That makes cart operations fast and accurate, but it also creates a durable operational object: an active or held POS session can reserve inventory until it completes, is voided, or expires. Operators need a focused view for answering "what is currently holding stock?" and a controlled action for clearing stale sessions.

Today the register exposes held sessions inside the active cashier workflow, but there is no store-level management surface for managers to inspect all active POS sessions and release holds deliberately. The new view should empower the operator without making the register workflow carry administrative recovery work.

## Scope

In scope:

- A POS-owned route at `packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/sessions.index.tsx`.
- A protected admin/operations view that lists active and held POS sessions for the current store.
- Session rows with operator, terminal/register, customer, cart totals, held item count, active hold details, expiry, status, and workflow trace links.
- A manager-gated command to expire an active or held POS session and release its active inventory holds.
- Operational audit and POS workflow trace updates for operator-driven expiry.
- Tests for query shape, authorization, release behavior, audit/trace behavior, and frontend command handling.

Out of scope:

- Resuming another operator's active session from the management view.
- Editing cart contents from the management view.
- Register-session closeout or drawer accounting changes.
- Background expiry scheduling changes beyond reusing the existing expiry/release primitives.
- Visual validation by agent; the user will do browser validation.

## Requirements

- R1. Managers can view all active and held POS sessions for a store from a POS operations route.
- R2. The view shows enough detail to decide whether a session is legitimate work in progress or stale inventory pressure.
- R3. The release action expires the POS session and releases active ledger holds in one authoritative server command.
- R4. The release action is manager/operations-gated and rejects cross-store or unauthorized actors.
- R5. Operator-driven expiry records audit history and POS workflow trace evidence.
- R6. The view follows the existing Athena app design language: compact, table-first, operational, and built from existing protected-view states.
- R7. Tests protect the query indexes, command semantics, authorization, audit/trace behavior, and frontend state handling.

## Current Findings

- `packages/athena-webapp/convex/inventory/posSessions.ts` already owns POS session queries, lifecycle mutations, item loading, and cron-style release behavior.
- `packages/athena-webapp/convex/inventory/helpers/inventoryHolds.ts` now exposes ledger hold release/read helpers that should be reused instead of reconstructing quantity release from cart rows.
- `packages/athena-webapp/convex/pos/application/commands/posSessionTracing.ts` already supports an `expired` lifecycle stage.
- `packages/athena-webapp/convex/operations/operationalEvents.ts` is the right audit rail for an operator-driven inventory-impacting action.
- `packages/athena-webapp/src/hooks/useProtectedAdminPageState.ts`, `packages/athena-webapp/src/components/operations/OperationsQueueView.tsx`, and `packages/athena-webapp/src/components/cash-controls/RegisterSessionsView.tsx` provide protected operational view patterns.
- `packages/athena-webapp/src/components/pos/session/HeldSessionsList.tsx` contains local held-session display ideas, but the new surface should be store-wide and table-first.

## Key Decisions

- Place the surface under POS at `/pos/sessions`, not under cash controls. It manages `posSession` and inventory holds, while cash controls manages drawer/register accountability.
- Add a narrow operator command instead of reusing the cashier-oriented void path directly. The command should make the action's purpose explicit: expire the session and release holds.
- Keep the first view table-first with a small summary strip. Cards are acceptable for mobile stacking, but the desktop primary surface should support scanning and comparison.
- Use manager/operations authorization at the server boundary. UI gating helps navigation, but the mutation must be authoritative.
- Record both operational audit and workflow trace because this action mutates durable session state and releases inventory pressure.

## Implementation Units

### U1. Add Backend Session-Ops Query

**Outcome:** A bounded store-scoped query returns active and held POS sessions with the details the operator view needs.

**Requirements:** R1, R2, R7.

**Files:**

- `packages/athena-webapp/convex/inventory/posSessions.ts`
- `packages/athena-webapp/convex/inventory/sessionQueryIndexes.test.ts`
- `packages/athena-webapp/convex/inventory/posSessions.trace.test.ts`
- `packages/athena-webapp/convex/pos/application/dto.ts`

**Tests:**

- Query uses `posSession.by_storeId_and_status` for active and held sessions.
- Query excludes completed, void, and expired sessions.
- Rows include cart item counts, totals, active hold quantities, customer/operator/register details, expiry, and trace id.
- Missing optional customer, terminal, staff, or register fields render as safe fallbacks in the DTO.

**Execution posture:** test-first.

**Observability / audit:** None -- read model only.

### U2. Add Manager-Gated Expire And Release Command

**Outcome:** A server command expires an active or held POS session, releases active ledger holds, records audit evidence, and emits an `expired` workflow trace stage.

**Requirements:** R3, R4, R5, R7.

**Files:**

- `packages/athena-webapp/convex/inventory/posSessions.ts`
- `packages/athena-webapp/convex/inventory/helpers/inventoryHolds.ts`
- `packages/athena-webapp/convex/operations/operationalEvents.ts`
- `packages/athena-webapp/convex/pos/application/commands/posSessionTracing.ts`
- `packages/athena-webapp/convex/lib/commandResultValidators.ts`
- `packages/athena-webapp/shared/commandResult.ts`
- `packages/athena-webapp/convex/inventory/posSessions.trace.test.ts`
- `packages/athena-webapp/convex/inventory/helpers/inventoryHolds.test.ts`

**Tests:**

- Manager can expire an active session and release active holds.
- Manager can expire a held session and release active holds.
- Non-manager, inactive staff, and cross-store staff are rejected.
- Completed and void sessions are not mutated.
- Re-running the command for an already-expired session is idempotent and does not double-release holds.
- Released/consumed holds are ignored; active holds become released with release timestamps.
- Audit event includes actor, prior status, released hold count, released quantity, register/session identifiers, and reason.
- Workflow trace records an `expired` stage once.

**Execution posture:** test-first.

**Observability / audit:** Operational audit event plus existing POS workflow trace lifecycle.

### U3. Build Protected POS Sessions View

**Outcome:** The UI route renders a protected POS operations view with summary counts, active/held session details, trace links, loading/empty/permission states, and per-row release action state.

**Requirements:** R1, R2, R3, R6, R7.

**Files:**

- `packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/sessions.index.tsx`
- `packages/athena-webapp/src/components/pos/sessions/POSSessionsView.tsx`
- `packages/athena-webapp/src/components/pos/sessions/POSSessionsViewContent.tsx`
- `packages/athena-webapp/src/components/pos/sessions/posSessionColumns.tsx`
- `packages/athena-webapp/src/components/pos/sessions/POSSessionsView.test.tsx`
- `packages/athena-webapp/src/components/pos/sessions/POSSessionsView.auth.test.tsx`

**Tests:**

- Auth loading skips protected queries and shows a layout-matching skeleton.
- Signed-out state renders `ProtectedAdminSignInView`.
- Unauthorized state renders `NoPermissionView`.
- Empty query result renders a calm operational empty state.
- Rows render session number, status, operator, terminal/register, customer fallback, cart count, total, active holds, expiry, and trace link.
- Release action disables only the active row, calls the command with session id and reason, and refreshes through Convex state.
- User-error command results use `presentCommandToast`.
- Action buttons have accessible names.

**Execution posture:** test-first.

**Observability / audit:** UI uses the server command; no separate durable audit record in the browser.

### U4. Connect Navigation And Repo Artifacts

**Outcome:** Operators can discover the view from the POS area, generated route/API/graph artifacts are fresh, and repo knowledge captures the new management capability.

**Requirements:** R1, R6, R7.

**Files:**

- `packages/athena-webapp/src/components/pos/PointOfSaleView.tsx`
- `packages/athena-webapp/src/routeTree.gen.ts`
- `packages/athena-webapp/convex/_generated/api.d.ts`
- `packages/athena-webapp/docs/agent/route-index.md`
- `packages/athena-webapp/docs/agent/test-index.md`
- `packages/athena-webapp/docs/agent/key-folder-index.md`
- `docs/solutions/performance/athena-pos-cart-latency-foundation-2026-05-05.md`
- `graphify-out/`

**Tests:**

- POS landing exposes the active-session management entry point.
- Generated route tree includes `/pos/sessions`.
- Pre-commit generated-artifact command is clean.
- Graphify check is fresh.

**Execution posture:** sensor-only for generated artifacts, test-first for navigation behavior.

**Observability / audit:** None -- navigation and docs only.

## Integration Strategy

This should land as one coordinated PR. Backend query/command and frontend route are tightly coupled by generated Convex API and route-tree artifacts; splitting them would mostly create generated-file churn rather than useful review boundaries.

Subagents can still work in parallel inside the integration branch:

- Backend worker: U1 and U2.
- Frontend worker: U3 and POS landing navigation from U4.
- Integration owner: generated artifacts, docs, graphify, validation, PR delivery.

## Validation Plan

- Focused backend tests for `posSessions`, `inventoryHolds`, operational audit, and session query indexes.
- Focused frontend tests for `POSSessionsView` and auth states.
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`.
- `bun run pre-commit:generated-artifacts`.
- `bun run pr:athena`.
- Remote PR checks with auto-merge armed through the repo helper.

## Linear Tracking

- U1: [V26-474 POS sessions ops: Add store-scoped active session read model](https://linear.app/v26-labs/issue/V26-474/pos-sessions-ops-add-store-scoped-active-session-read-model)
- U2: [V26-475 POS sessions ops: Expire sessions and release holds from operator command](https://linear.app/v26-labs/issue/V26-475/pos-sessions-ops-expire-sessions-and-release-holds-from-operator)
- U3: [V26-476 POS sessions ops: Build protected active sessions view](https://linear.app/v26-labs/issue/V26-476/pos-sessions-ops-build-protected-active-sessions-view)
- U4: [V26-477 POS sessions ops: Wire navigation docs and generated artifacts](https://linear.app/v26-labs/issue/V26-477/pos-sessions-ops-wire-navigation-docs-and-generated-artifacts)

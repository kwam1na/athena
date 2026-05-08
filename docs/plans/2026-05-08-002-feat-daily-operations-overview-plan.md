---
title: "feat: Build Daily Operations Overview"
type: feat
status: active
date: 2026-05-08
origin: docs/brainstorms/2026-05-08-daily-operations-overview-requirements.md
---

# feat: Build Daily Operations Overview

## Summary

Build the Operations landing route into Athena's store-day command center. The overview should compose Daily Opening, Daily Close, open work, approvals, cash/POS state, domain lane posture, and operational events into one read-oriented operator surface without taking ownership of subsystem workflows.

---

## Problem Frame

Daily Opening and Daily Close now provide the lifecycle ends of the store day, and the Operations area already has open work, approvals, stock adjustments, and daily lifecycle subroutes. The missing layer is the active-day overview: an operator entering `/operations` still lands in Open Work rather than seeing whether the store is opened, operating cleanly, blocked, ready to close, or already closed.

The implementation should create a parent orientation surface, not a new workflow owner. POS, Cash Controls, Services, Procurement, Orders, Stock, Open Work, and Approvals remain the source of truth for their actions; Daily Operations only composes posture, ranks attention, shows the next responsible action, and routes the operator to the owning workflow.

---

## Requirements Traceability

Origin: `docs/brainstorms/2026-05-08-daily-operations-overview-requirements.md`

- R1-R5: Single store-day state, operating-date consistency, persisted Opening/Close posture, and primary next action.
- R6-R10: Cross-domain attention queue with severity, ownership, resolution path, and explicit empty states.
- R11-R14: Compact domain lanes for Cash Controls, POS, Approvals, Open Work, Stock/Procurement, Services, Orders, and events where available.
- R15-R18: Daily Opening and Daily Close stay dedicated flows; the overview presents and routes to them.
- R19-R22: Store-day timeline and read-only closed-day review.
- R23-R25: Workflow ownership boundaries and read-oriented domain lanes.

---

## Context And Patterns

- `packages/athena-webapp/convex/operations/dailyOpening.ts` and `packages/athena-webapp/convex/operations/dailyClose.ts` already provide server-owned store-day readiness snapshots and command-time lifecycle enforcement.
- `packages/athena-webapp/convex/operations/operationalWorkItems.ts` exposes the current queue snapshot for open work and approvals.
- `packages/athena-webapp/convex/operations/operationalEvents.ts` is the existing audit/event rail; the overview should read from it rather than create a second event log.
- `packages/athena-webapp/src/components/operations/DailyOpeningView.tsx`, `packages/athena-webapp/src/components/operations/DailyCloseView.tsx`, and `packages/athena-webapp/src/components/operations/OperationsQueueView.tsx` provide protected operations page, bucket, rail, and command-result patterns.
- `packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/index.tsx` currently redirects to Open Work; this should become the overview entry point.
- The Athena design system favors calm, compact operational workspaces using `PageLevelHeader`, `PageWorkspace`, `PageWorkspaceGrid`, and `PageWorkspaceRail`.

---

## Key Technical Decisions

- **Add a Daily Operations read model:** The overview needs one server-owned source for lifecycle state, next action, attention items, lanes, and timeline input. React should render the returned posture instead of recreating policy.
- **Keep the first lane set pragmatic:** Cash Controls, POS sessions, Approvals, Open Work, and lifecycle state should be first-class in v1. Services, Orders, Stock, and Procurement can render limited or not-applicable lanes until each domain has mature close/opening policies.
- **Rank severity without moving ownership:** The overview can sort cross-domain items, but each item must preserve its source owner and route to the owning workflow.
- **Use existing events for timeline:** Store-day timeline should read lifecycle records and operational events. It should not write new timeline-only records.
- **Make `/operations` the overview:** Open Work remains available at `/operations/open-work`; the parent route should stop redirecting.
- **Coordinate generated artifacts once:** New Convex exports, route-tree changes, generated docs, and graphify artifacts should be regenerated once in the integration branch after the implementation units land.

---

## Implementation Units

- U1. **Add Daily Operations overview read model**

  **Goal:** Return one store-day overview snapshot with lifecycle state, primary next action, attention items, initial domain lanes, and timeline input.

  **Requirements:** R1-R14, R15-R19, R23-R25

  **Files:**
  - Create: `packages/athena-webapp/convex/operations/dailyOperations.ts`
  - Modify: `packages/athena-webapp/convex/operations/dailyOpening.ts`
  - Modify: `packages/athena-webapp/convex/operations/dailyClose.ts`
  - Modify: `packages/athena-webapp/convex/operations/operationalWorkItems.ts`
  - Modify: `packages/athena-webapp/convex/operations/operationalEvents.ts`
  - Test: `packages/athena-webapp/convex/operations/dailyOperations.test.ts`
  - Test: `packages/athena-webapp/convex/operations/operationsQueryIndexes.test.ts`

  **Approach:**
  - Compose existing Daily Opening and Daily Close snapshots rather than duplicating their lifecycle policy.
  - Define store-day state precedence for v1: closed, close blocked, ready to close, attention needed, operating, opening blocked/in progress, not opened.
  - Build a primary next-action descriptor that routes to Daily Opening, Daily Close, Cash Controls, Approvals, POS sessions, or Open Work according to the highest-severity condition.
  - Normalize attention items from opening/close blockers, queue work, approvals, register/POS blockers, and carry-forward work into a common read-only shape.
  - Return initial lanes for lifecycle, Cash Controls, POS, Approvals, Open Work, and limited lanes for Stock/Procurement, Services, Orders, and Operational Events.
  - Read timeline input from existing lifecycle records and operational events within the same validated operating-date range.
  - Keep the function query-only; no operational events or workflow mutations should be created by the overview read.

  **Execution posture:** test-first.

  **Observability / audit:** None -- this unit creates a read model only and must not mutate durable state.

  **Test scenarios:**
  - No Opening record returns not-opened/opening state and Daily Opening as the next action.
  - Completed Opening with no blockers returns operating or ready-to-close state depending on close snapshot.
  - Open register session or active/held POS session returns close-blocked state with source owner and route.
  - Pending approval and open work appear in the attention queue with severity, source owner, status, and route.
  - Existing Daily Close completed returns closed/read-only posture.
  - Zero-activity operating date returns an explicit calm or zero-activity posture, not an unloaded/error posture.
  - Timeline input respects the same operating-date range as Opening and Close.

  **Expected sensors:**
  - `bun run --filter '@athena/webapp' test -- convex/operations/dailyOperations.test.ts convex/operations/dailyOpening.test.ts convex/operations/dailyClose.test.ts convex/operations/operationsQueryIndexes.test.ts`
  - `bun run --filter '@athena/webapp' audit:convex`
  - `bun run --filter '@athena/webapp' lint:convex:changed`

- U2. **Build the core Daily Operations overview UI**

  **Goal:** Replace the `/operations` redirect with a protected overview page that renders store-day state, next action, attention queue, and core empty/loading/access states.

  **Requirements:** R1-R10, R15-R18, R23-R25

  **Files:**
  - Modify: `packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/index.tsx`
  - Create: `packages/athena-webapp/src/components/operations/DailyOperationsView.tsx`
  - Test: `packages/athena-webapp/src/components/operations/DailyOperationsView.test.tsx`
  - Test: `packages/athena-webapp/src/components/operations/OperationsQueueView.test.tsx`

  **Approach:**
  - Follow the protected admin patterns from Daily Opening, Daily Close, and Operations Queue.
  - Use page-level workspace primitives for a compact operational layout: status header, main attention queue, and right rail for next action.
  - Render the primary next action as navigation into the owning workflow, not as inline subsystem mutation.
  - Preserve useful empty states for healthy, not-applicable, and zero-activity states.
  - Keep route links compatible with the existing Operations subroutes.

  **Execution posture:** test-first.

  **Observability / audit:** None -- this unit renders a read-only overview and navigation prompts only.

  **Test scenarios:**
  - `/operations` renders the overview instead of redirecting to Open Work.
  - Loading, signed-out, no-permission, and no-active-store states match existing Operations page behavior.
  - Not-opened state shows Daily Opening as the primary next action.
  - Close-blocked state explains the highest-priority blocker and does not offer inline close or subsystem mutation.
  - Ready-to-close state makes Daily Close the primary next action.
  - Attention queue renders source domain, severity, status, and owning-workflow link.

  **Expected sensors:**
  - `bun run --filter '@athena/webapp' test -- src/components/operations/DailyOperationsView.test.tsx src/components/operations/DailyOpeningView.test.tsx src/components/operations/DailyCloseView.test.tsx src/components/operations/OperationsQueueView.test.tsx`
  - `bun run --filter '@athena/webapp' lint:frontend:changed`
  - `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`

- U3. **Add domain lane rendering for active store-day posture**

  **Goal:** Present compact domain lanes that show health, counts, explanation, and route for each relevant operating area without becoming mini workspaces.

  **Requirements:** R11-R14, R23-R25

  **Files:**
  - Modify: `packages/athena-webapp/convex/operations/dailyOperations.ts`
  - Modify: `packages/athena-webapp/src/components/operations/DailyOperationsView.tsx`
  - Test: `packages/athena-webapp/convex/operations/dailyOperations.test.ts`
  - Test: `packages/athena-webapp/src/components/operations/DailyOperationsView.test.tsx`
  - Related focused tests as needed: `packages/athena-webapp/src/components/cash-controls/CashControlsDashboard.test.tsx`, `packages/athena-webapp/src/components/pos/sessions/POSSessionsView.test.tsx`, `packages/athena-webapp/src/components/procurement/ProcurementView.test.tsx`, `packages/athena-webapp/src/components/services/ServiceCasesView.test.tsx`

  **Approach:**
  - Treat lane content as read-oriented posture: healthy, warning, critical, informational, or not applicable.
  - Start with strong lanes for lifecycle, Cash Controls, POS, Approvals, and Open Work.
  - Add limited/not-applicable lanes for Stock/Procurement, Services, and Orders when a source domain has no mature daily-operations policy yet.
  - Each lane should include enough detail to decide whether to click through, not enough controls to complete the source workflow.

  **Execution posture:** test-first.

  **Observability / audit:** None -- lanes are read-only summaries and route prompts.

  **Test scenarios:**
  - Cash Controls lane is critical when register state blocks close.
  - POS lane is critical or warning when active/held POS sessions exist, depending on close posture.
  - Approvals lane is critical for close-blocking approval state and warning for non-blocking pending work.
  - Open Work lane distinguishes required carry-forward blockers from due-today work.
  - Services, Orders, Stock, and Procurement can render not-applicable or limited lanes without looking broken.
  - Lane state can differ from the overall store-day state.

  **Expected sensors:**
  - `bun run --filter '@athena/webapp' test -- convex/operations/dailyOperations.test.ts src/components/operations/DailyOperationsView.test.tsx`
  - Add domain-focused tests when a lane reads new source-domain behavior.
  - `bun run --filter '@athena/webapp' audit:convex`
  - `bun run --filter '@athena/webapp' lint:convex:changed`
  - `bun run --filter '@athena/webapp' lint:frontend:changed`

- U4. **Add store-day timeline and closed-day review behavior**

  **Goal:** Show a business-readable store-day narrative and make closed or past store days reviewable without live urgency or inline subsystem actions.

  **Requirements:** R19-R22

  **Files:**
  - Modify: `packages/athena-webapp/convex/operations/dailyOperations.ts`
  - Modify: `packages/athena-webapp/convex/operations/operationalEvents.ts`
  - Modify: `packages/athena-webapp/src/components/operations/DailyOperationsView.tsx`
  - Test: `packages/athena-webapp/convex/operations/dailyOperations.test.ts`
  - Test: `packages/athena-webapp/src/components/operations/DailyOperationsView.test.tsx`

  **Approach:**
  - Assemble timeline rows from existing lifecycle records and operational events scoped to the selected operating-date range.
  - Normalize event copy into operator-facing labels and descriptions.
  - Show closed and prior-day views as review surfaces: completed lifecycle posture, carry-forward context, timeline, and routes to source details.
  - Do not introduce timeline-only writes, event duplication, or correction/reopen behavior.

  **Execution posture:** test-first.

  **Observability / audit:** None -- the timeline reads existing operational event and lifecycle records only.

  **Test scenarios:**
  - Opening, approval, POS, stock/open-work, and close events render in chronological order for the selected operating date.
  - Events outside the operating-date range are excluded.
  - Raw backend event type strings are not shown as primary operator copy.
  - Closed day shows read-only summary posture and no live urgency.
  - Late or correction-relevant event is routed as follow-up context rather than silently mutating a closed summary.

  **Expected sensors:**
  - `bun run --filter '@athena/webapp' test -- convex/operations/dailyOperations.test.ts src/components/operations/DailyOperationsView.test.tsx convex/operations/operationsQueryIndexes.test.ts`
  - `bun run --filter '@athena/webapp' audit:convex`
  - `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`

- U5. **Wire navigation, generated artifacts, docs, and harness coverage**

  **Goal:** Make the overview discoverable, regenerate derived artifacts once, and update repo knowledge so future agents know `/operations` is the Daily Operations overview.

  **Requirements:** R1-R25

  **Files:**
  - Modify: `packages/athena-webapp/src/components/app-sidebar.tsx`
  - Modify generated as needed: `packages/athena-webapp/src/routeTree.gen.ts`
  - Modify generated as needed: `packages/athena-webapp/convex/_generated/api.d.ts`
  - Regenerate generated docs as needed: `packages/athena-webapp/docs/agent/route-index.md`, `packages/athena-webapp/docs/agent/test-index.md`, `packages/athena-webapp/docs/agent/key-folder-index.md`, `packages/athena-webapp/docs/agent/validation-guide.md`
  - Update docs as needed: `packages/athena-webapp/docs/agent/architecture.md`, `packages/athena-webapp/docs/agent/code-map.md`
  - Regenerate as needed: `graphify-out/`
  - Test: `packages/athena-webapp/src/components/operations/DailyOperationsView.test.tsx`

  **Approach:**
  - Update Operations navigation so the parent Operations entry means Daily Operations Overview while Open Work remains a subroute.
  - Regenerate Convex and TanStack Router artifacts after API and route changes.
  - Refresh generated harness docs and graphify once after the integrated feature is stable.
  - Update human-readable agent docs to reflect the new standing behavior and validation surface.

  **Execution posture:** sensor-only.

  **Observability / audit:** None -- generated artifacts and docs only.

  **Test scenarios:**
  - Sidebar Operations entry routes to the overview.
  - Open Work, Approvals, Stock Adjustments, Daily Opening, and Daily Close remain discoverable.
  - Generated route/API/docs artifacts are clean after regeneration.
  - Graphify reflects the new overview surface.

  **Expected sensors:**
  - `bun run pre-commit:generated-artifacts`
  - `bun run graphify:rebuild`
  - `bun run --filter '@athena/webapp' test -- src/components/operations/DailyOperationsView.test.tsx`
  - `bun run --filter '@athena/webapp' build`
  - `bun run pr:athena` before merge-ready handoff.

---

## Integration Strategy

Track the work as separate Linear issues, but execute as a coordinated batch. U1 through U4 can be developed in parallel with careful ownership boundaries, but they share generated Convex API, route tree, harness docs, and graphify outputs. Prefer a single integration PR that regenerates shared artifacts once after the feature slices are combined.

---

## Validation Plan

Focused validation during implementation:

- `bun run --filter '@athena/webapp' test -- convex/operations/dailyOperations.test.ts convex/operations/dailyOpening.test.ts convex/operations/dailyClose.test.ts convex/operations/operationsQueryIndexes.test.ts`
- `bun run --filter '@athena/webapp' test -- src/components/operations/DailyOperationsView.test.tsx src/components/operations/DailyOpeningView.test.tsx src/components/operations/DailyCloseView.test.tsx src/components/operations/OperationsQueueView.test.tsx`
- Domain-focused tests when a lane starts reading new source behavior.

Final validation before merge:

- `bun run --filter '@athena/webapp' audit:convex`
- `bun run --filter '@athena/webapp' lint:convex:changed`
- `bun run --filter '@athena/webapp' lint:frontend:changed`
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `bun run --filter '@athena/webapp' build`
- `bun run pre-commit:generated-artifacts`
- `bun run graphify:rebuild`
- `bun run pr:athena`

Browser validation:

- Visit `/operations` for a current store day before Opening, after Opening, with close blockers, ready-to-close, and closed-day states.
- Verify the overview is usable at desktop and mobile widths.
- Verify next actions route to Daily Opening, Daily Close, Cash Controls, POS sessions, Approvals, Open Work, Stock/Procurement, Services, and Orders where applicable.

---

## Risks

- **Scope creep into subsystem work:** Keep all source-domain mutations in owning workflows. The overview should not approve, close, receive, fulfill, void, or mutate domain records.
- **State precedence ambiguity:** Store-day state needs deterministic ordering so a page cannot say both operating and close blocked without explaining why.
- **Timeline drift:** Reuse operational events and lifecycle records rather than creating a second history stream.
- **Query scale:** Add indexed access or bounded reads whenever a new source table joins the overview.
- **Generated-artifact churn:** Regenerate shared artifacts once in an integration branch to avoid merge noise across parallel tickets.

---

## Follow-Up Work

- Add richer Services, Orders, Stock, and Procurement lane policies once each domain has explicit daily-operations semantics.
- Add configurable operating-day policy if store hours, holidays, or skipped trading days need more than the existing Opening/Close date range contract.
- Add correction/reopen workflows for completed store days if the business wants formal post-close adjustment handling.

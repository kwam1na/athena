---
title: "feat: Make athena-webapp mobile and tablet responsive across surfaces"
type: feat
status: active
date: 2026-05-01
---

# feat: Make athena-webapp mobile and tablet responsive across surfaces

## Summary

Improve mobile and tablet responsiveness across Athena webapp surfaces by normalizing shell/mobile breakpoints and shared container behavior in reusable primitives, then validating layout behavior across representative routes and surfaces.

## Problem Frame

Athena webapp has a shared shell (`View`, `sidebar`, `use-mobile`, and `container` usage) that currently behaves inconsistently at mobile/tablet widths. Several screens become awkward on smaller widths due desktop-oriented sidebar and container assumptions. This work prioritizes shared layout primitives and safe responsive defaults so existing pages inherit better behavior without broad one-off rewrites.

## Requirements

- R1. Treat tablet widths as a mobile-first shell mode to avoid cramped desktop-sidebar layouts.
- R2. Apply consistent horizontal safe spacing and overflow control in shared containers used by most screens.
- R3. Keep existing route and business logic intact; scope is strictly presentation/layout responsiveness.
- R4. Verify all changed patterns against current webapp test and validation sensors.
- R5. Validate changes via browser-level run on key representative routes in mobile and tablet widths.

## Scope Boundaries

- In scope: shared responsive layout primitives in `packages/athena-webapp/src` (`View`, `use-mobile`, `sidebar`, global container spacing)
- In scope: validation and docs updates needed for responsive behavior changes.
- Out of scope: functional behavior changes in POS/payment/convex command flows and route-level business logic.
- Out of scope: full redesign of every page-specific grid/table layout.

## Context and Research

- `packages/athena-webapp/src/components/View.tsx` defines the highest shared viewport shell for content.
- `packages/athena-webapp/src/components/ui/sidebar.tsx` and `packages/athena-webapp/src/hooks/use-mobile.tsx` govern sidebar behavior that heavily affects mobile/tablet usability.
- `packages/athena-webapp/src/components/ui/sidebar.tsx` and `_authed.tsx` determine shell/rail composition on non-desktop widths.
- `packages/athena-webapp/src/index.css` and Tailwind utility usage are the right place for shared spacing/overflow helpers.
- Mobile behavior expectation is also influenced by `useIsMobile`-gated behavior across shell components.

## Implementation Units

- U1. Update mobile breakpoint semantics for shell composition
  - Files:
    - `packages/athena-webapp/src/hooks/use-mobile.tsx`
  - Approach:
    - Raise the mobile breakpoint to treat tablet as mobile shell mode.
    - Keep all existing callers untouched; behavior changes should be opt-in by width only.
  - Test focus:
    - Unit test for `useIsMobile` boundary behavior at width transitions around `1024px`.

- U2. Normalize shared `View` shell padding and overflow behavior
  - Files:
    - `packages/athena-webapp/src/components/View.tsx`
  - Approach:
    - Add mobile/tablet-safe horizontal padding and min-width handling for contained layouts.
    - Ensure content wrapper uses explicit overflow guards to prevent horizontal clipping issues.
  - Test focus:
    - Snapshot/behavior tests if any currently cover `View` rendering at narrow widths.
    - Route-level smoke checks for nested container content no longer overflowing when wrapped in `View`.

- U3. Add responsive container spacing defaults used by many existing pages
  - Files:
    - `packages/athena-webapp/src/index.css`
  - Approach:
    - Introduce a lightweight global style for `.container` to guarantee predictable side padding and layout continuity on mobile/tablet.
    - Keep semantics opt-in and non-destructive for existing desktop layout intent.
  - Test focus:
    - Visual/manual review of representative container-heavy routes at small widths.

- U4. Validation pass and merge-ready execution
  - Files:
    - `docs/plans/2026-05-01-001-feat-athena-webapp-mobile-tablet-responsiveness-plan.md` (plan and scope closure)
  - Approach:
    - Run targeted package tests + typecheck/build + harness checks impacted by changed modules.
    - Execute browser-level width validation for representative mobile/tablet routes.
    - Deliver via worktree, open PR, merge into `main`, close local worktree cleanly.

## Test Scenarios

- Desktop parity: desktop route renders unchanged spacing and no layout regressions for 3 representative views.
- Mobile shell mode: sidebar uses off-canvas behavior on widths below tablet breakpoint.
- Tablet shell mode: `PointOfSaleView` and one route with container-heavy layout remain usable at `1024px` width and below without horizontal overflow.
- Long content pages: key `container mx-auto` routes render within viewport width at small widths.

## Observability / Validation

- `bun run --filter '@athena/webapp' test`
- `bun run harness:review`
- `bun run --filter '@athena/webapp' test -- src/components/orders/OrdersView.test.tsx src/components/analytics/AnalyticsView.test.tsx src/components/pos/PointOfSaleView.test.tsx` (as available)
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `bun run --filter '@athena/webapp' build`
- `bun run graphify:rebuild`
- Browser width validation on representative pages via a browser run in mobile and tablet breakpoints.

# Operations workspace screenshot fixtures

Date: 2026-07-19
Status: proposed
Scope: `packages/athena-webapp` — Daily Operations, Opening Handoff, EOD Review

## Goal

Capture product screenshots of the three operations workspaces telling an arbitrary,
authored story — for Daily Operations specifically, a defined sales history and a
defined current day — rendered inside the real application chrome.

## What changed from the audit

The feasibility audit (2026-07-19, read-only) recommended a snapshot-override seam on
the three `XView` guards. The follow-up chrome audit refines that: **the chrome and the
workspace need different data sources, and that split is the design.**

The app shell has no router-level auth gate. `Layout` (`src/routes/-authed-layout.tsx:643`)
returns `null` and redirects to `/login` until `useAuth()` resolves a real Convex user
(`:744-794`). `AppSidebar` hard-bails at `src/components/app-sidebar.tsx:310` unless
`useGetActiveStore()` and `useGetActiveOrganization()` both resolve. So real chrome
requires a real session against a real store, no matter what we do to the workspace.

That is not an obstacle — it is the cheapest correct answer. Sign in normally (dev store
or `/demo`), let the chrome render from real data, and override only the workspace
snapshot. No Convex interception, no Storybook router/provider stack, no seeding.

## Non-goals

- Seeding backdated data into Convex. The server sweep found two behavioral clock
  couplings on read paths (V26-1082, V26-1083) that would corrupt seeded historic days.
  Those are tracked separately and are not prerequisites for this work, because this
  plan never executes the affected queries.
- Making an arbitrary date read as "today" on the server. Client-only.
- Interactive demos. These fixtures are for capture, not for driving.
- Storybook. `.storybook-athena/main.ts:10-17` deliberately strips the TanStack Router
  plugins and `preview.ts` mounts no Convex provider; real chrome is out of reach there
  without disproportionate work.

## Work

### 1. Centralize the operating-date clock

`getLocalOperatingDate` and `getLocalOperatingDateRange` are duplicated verbatim in all
three files: `DailyOperationsView.tsx:477/485`, `DailyOpeningView.tsx:264/272`,
`DailyCloseView.tsx:853/891`.

Extract to one module (suggested: `src/lib/operations/operatingDate.ts`) taking an
optional `now`. Thread an optional override to the residual clock reads in the render
trees:

- `DailyOperationsView.tsx:3110` — `getLocalOperatingDate()` inside `WeekMetricsStrip`,
  decides week-nav bounds and which bar reads as the current day.
- Calendar `latestSelectableDate` defaults: `DailyOperationsView.tsx:3033`,
  `DailyOpeningView.tsx:1763`, `DailyCloseView.tsx:3336`.

`DailyCloseViewContentProps.latestSelectableOperatingDate` (`DailyCloseView.tsx:325`)
already exists and is exercised at `DailyCloseView.test.tsx:1183` — match that naming, or
rename all three together. Note the existing internal asymmetry
(`latestSelectableOperatingDate` on props vs `latestSelectableDate` internally).

This is a pure refactor. Behavior with no override must be byte-identical.

### 2. Snapshot-override prop on the three guards

`DailyOperationsView:4660`, `DailyOpeningView:2331`, `DailyCloseView:4503` currently take
zero props and resolve query refs at runtime, forwarding them to a module-private
`XConnectedView`. Add one optional prop per guard that short-circuits `ConnectedView` and
renders `XViewContent` directly from a supplied snapshot.

The Content components are already exported and already driven by synthetic props in
their sibling `.test.tsx` files — those are the reference for prop shape. Two callbacks
are required and need no-op stubs: `DailyOpeningViewContent.onStartDay`,
`DailyCloseViewContent.onComplete`.

When the override is present no Convex query runs, which is what keeps V26-1082 and
V26-1083 off this path entirely.

### 3. Fixture registry

One module per workspace, typed against the exported snapshot types
(`DailyOperationsSnapshot:216`, `DailyOpeningSnapshot:134`, `DailyCloseSnapshot:167`).

`src/components/landing/story/demoDayFixtures.ts` is the existing precedent — a 383-line
hand-built `DailyCloseSnapshot` fixture already consumed by five landing scenes. Extend
that pattern rather than inventing a second one.

Sales history for Daily Operations is `snapshot.weekMetrics` (`:325-341`), one row per
day: `operatingDate`, `salesTotal`, `transactionCount`, `currentDayCashTotal`,
`expenseTotal`, `paymentTotals[]`, `isClosed`, `isReopened`, `isSelected`. Authoring that
array *is* authoring the sales history.

Gate to respect: the week strip only renders when `hasHydratedWeekAnalytics`
(`DailyOperationsView.tsx:3527-3529`) — set `hasDetailSnapshot: true` with non-empty
`weekMetrics`, or pass `cachedWeekMetrics` directly. Otherwise it falls through to a
request-to-load stub.

One serialization constraint: `DailyOpeningItem.metadata[].value` is `ReactNode`
(`DailyOpeningView.tsx:122`). Use the `Record<string, unknown>` branch of that union to
keep fixtures pure data. `DailyCloseItem` has no such issue (`value: string`).

### 4. Dev-gated activation

A search param on the three existing routes (suggested `?fixture=<name>`) resolved
against the registry and passed into the guard.

The router uses generated file-based routing, so route files are emitted unconditionally
and the guard must be in-component: `import.meta.env.DEV` (the established idiom —
`src/main.tsx:17`, `src/components/Navbar.tsx:14`). In production the param must be
inert and the fixture modules must not reach the bundle. Verify the second part by
inspecting the prod build output, not by reading the import graph.

## Known fidelity gap — needs a decision

**The sidebar will show real counts while the workspace shows fixture data.**

`AppSidebar` computes its badges from live Convex queries keyed on the real
`activeStore._id` — open work items and pending approvals at `app-sidebar.tsx:285` and
`:300`, plus order/review/catalog counts. Those queries are untouched by a workspace-level
override. A fixture depicting twelve pending approvals will sit beside a sidebar badge
reading whatever the signed-in store actually has, possibly zero.

Three options, in increasing cost:

1. **Accept it.** Fine if screenshots crop out the sidebar or the numbers happen not to
   contradict. Zero work.
2. **Choose a signed-in store whose real counts roughly match the story.** Zero code,
   some setup friction, fragile over time.
3. **Extend the override to the sidebar counts.** Faithful, and the cleanest chokepoint
   is `useGetActiveStore` / `useGetActiveOrganization` plus the two count queries — but it
   widens the change from three leaf components into shared chrome used by every route.

Recommend starting at (1) and escalating only if a screenshot actually shows the conflict.
Deciding this before implementation matters, because (3) changes the shape of the work.

## Sensors

- Existing `DailyOperationsView.test.tsx`, `DailyOpeningView.test.tsx`,
  `DailyCloseView.test.tsx` must pass unchanged — they are the regression guard for the
  step-1 refactor.
- Typecheck and build.
- Prod build inspected for fixture-module absence.
- `bun run pr:athena`.
- Runtime: load each workspace with and without the param; without it, behavior and
  network activity must be identical to today.

## Risks

- **Prod leakage.** A fixture path that renders authored operational numbers inside real
  chrome is a misleading-data risk if it ever activates outside dev. The dev gate and the
  bundle check are the mitigations; treat both as required, not optional.
- **Refactor blast radius.** Step 1 touches three 2k-4k line files that own money-adjacent
  close and opening flows. It is a pure extraction, but the diff will be wide.
- **Fixture drift.** Snapshot types will evolve and hand-built fixtures will rot. Typing
  them against the exported types means drift surfaces as a typecheck failure rather than
  a broken screenshot.

## Sequencing

Step 1 stands alone and is independently mergeable — it is a refactor with no feature
attached, and shipping it separately keeps the wide diff reviewable on its own terms.
Steps 2-4 are one change; splitting them yields a seam with nothing driving it.

## Decisions (2026-07-19)

1. Sidebar fidelity — **option 1, accept the gap.** No chrome-level override. Escalate
   only if a captured screenshot actually shows a contradiction.
2. Capture session — **`/demo` against a dev store.**
3. Fixture location — **`src/stories/`**, not beside the components.

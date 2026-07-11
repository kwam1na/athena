# Athena landing product-proof manifest

Manifest version: `draft-1`

Status: **no approved public claims or assets**

Repository source revision: `16408432583c9732f8e0685a1766315e47f2f4d4`

Audit date: `2026-07-11`

Manifest owner: **unassigned — blocks approval**

Launch date: **not set**

This is the versioned source-of-truth for landing claims and proof assets. Rows marked `candidate` describe product capability boundaries evidenced in the repository; they are not approved landing copy, customer outcomes, or market proof.

## Review policy

- Only a named product owner may change a row to `approved`.
- Every approved claim must cite current product evidence and an accountable owner.
- Every approved asset must cite a production-owned sanitized fixture or an audited export, not the pitch source path.
- Review immediately when the referenced Store Pulse, reporting, procurement, Daily Operations, or Daily Close semantics change.
- Otherwise review at least every six months. Before launch, set each approved row's next review date to a date no later than six months after launch.
- Any row with an overdue review date automatically returns to `blocked` until re-audited.

## Candidate claim registry

The `Capability boundary` column is evidence language for reviewers, not final marketing copy.

| ID | Narrative role | Capability boundary | Source surface or contract | Source revision | Audit date | Accountable owner | Next review | Status / blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `spine-sales-today` | Today's sales standing | Store Pulse can present completed POS sales and related transaction/item counts for its selected window, subject to financial visibility and snapshot completeness. | `src/components/store-pulse/StorePulseSummaryView.tsx` | `16408432583c9732f8e0685a1766315e47f2f4d4` | 2026-07-11 | `[unassigned]` | `[set at approval; <= launch + 6 months]` | Candidate; copy, fixture, and owner not approved |
| `spine-history` | Historical comparison | Store Pulse supports Athena-recorded comparison windows and trend history; history accumulates through Athena use and may be limited. | `StorePulseSummaryView.tsx`; Store Pulse reuse solution | same | 2026-07-11 | `[unassigned]` | `[required]` | Candidate; must state history boundary |
| `spine-products` | Product drivers | Store Pulse can show top-item movement for the same evidence window. | `StorePulseSummaryView.tsx`; `POSSalesPulseView.test.tsx` | same | 2026-07-11 | `[unassigned]` | `[required]` | Candidate; no causal/profit claim |
| `spine-stock` | Current stock pressure | Procurement presents inventory/availability, vendor, planned/inbound cover, exceptions, and purchase-order context. | `src/components/procurement/ProcurementView.tsx`; `convex/stockOps/replenishment.ts` | same | 2026-07-11 | `[unassigned]` | `[required]` | Candidate; no sales-derived recommendation claim |
| `spine-owner-action` | Owner-led action | A reviewer can add selected pressure rows to a vendor-backed draft and create purchase orders, then track receiving. | `ProcurementView.tsx` | same | 2026-07-11 | `[unassigned]` | `[required]` | Candidate; owner decision must stay explicit |
| `breadth-cross-channel` | **The one cross-channel moment** | Canonical reporting recognizes completed POS and first-fulfilled storefront commerce under one store model while preserving channel identity. | `shared/reportingContract.ts`; `convex/reporting/facts.ts`; `convex/reporting/commerceRecognition.test.ts` | same | 2026-07-11 | `[unassigned]` | `[required]` | Candidate; no public-safe visual and no claim that Store Pulse includes storefront activity |
| `breadth-team-control` | **The one small-team control moment** | Daily Operations/EOD Review can present store-day status, pending approvals, cash variance, and completion attribution under role and policy boundaries. | `DailyOperationsView.tsx`; `DailyCloseView.tsx`; closeout-hold solution | same | 2026-07-11 | `[unassigned]` | `[required]` | Candidate; no sanitized visual or owner approval |

Exactly the two `breadth-*` rows above may support the broad operating-system story in this delivery. Adding another breadth moment requires reopening the approved requirements, not silently extending this manifest.

## Transition registry

| ID | From → to | Evidence | Status / constraint |
| --- | --- | --- | --- |
| `transition-1` | Today's standing → history | Same Store Pulse contract and presentation provide window, comparison, and trend semantics. | Candidate |
| `transition-2` | History → product drivers | Same Store Pulse operator snapshot provides comparison/trend and top-item movement for the selected evidence window. | Candidate; do not imply causation |
| `transition-3` | Product drivers → stock pressure | Shared SKU identity exists across Store Pulse and Procurement; protected SKU insight projections combine sales, inventory, and procurement evidence internally. | **Blocked until a same-SKU public-safe composition is approved; protected projection cannot be queried anonymously** |
| `transition-4` | Stock pressure → owner action | Procurement exposes a human-reviewed pressure row and explicit draft/order actions. | Candidate; do not imply autonomous ordering |

## Asset registry

| Asset ID | Public filename | Narrative role | Source fixture/export revision | Safety audit | Owner | Next review | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `hero-proof` | `[not exported]` | Sales standing, history, and product drivers | `[not selected]` | `[not run]` | `[unassigned]` | `[required]` | Blocked |
| `stock-proof` | `[not exported]` | Same-SKU current stock pressure and owner action | `[not selected]` | `[not run]` | `[unassigned]` | `[required]` | Blocked |
| `cross-channel-proof` | `[not exported]` | The one cross-channel moment | `[not selected]` | `[not run]` | `[unassigned]` | `[required]` | Blocked |
| `team-control-proof` | `[not exported]` | The one small-team control moment | `[not selected]` | `[not run]` | `[unassigned]` | `[required]` | Blocked |
| `open-graph` | `[not exported]` | Social preview | `[not selected]` | Must be independently audited | `[unassigned]` | `[required]` | Blocked |

The pitch captures are not registered as public assets because the proof audit found organization/account identifiers and, in some cases, customer and operational data. A final asset must be a new sanitized export with a generic filename and a completed audit row.

## Approval ledger

| Manifest version | Decision | Product owner | Decision date | Positioning gate revision | Proof audit revision | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `draft-1` | Blocked | `[unassigned]` | 2026-07-11 | Research not run | Candidate audit only | No public claim or asset approved |

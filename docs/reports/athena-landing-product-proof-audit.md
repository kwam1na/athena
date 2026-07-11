# Athena landing product-proof audit

Status: **candidate evidence mapped; final proof approval blocked**

Repository revision audited: `16408432583c9732f8e0685a1766315e47f2f4d4`

Audit date: `2026-07-11`

Accountable product owner: **unassigned**

This audit maps the proposed landing narrative to current Athena behavior. It does not approve public copy or assets. Protected product queries remain protected; any landing proof must be recreated from production-owned sanitized fixtures or newly exported, independently audited media.

## Audit rules

- A stage requires a current reviewable product surface or contract.
- A transition requires visible, understandable evidence connecting both stages. Shared backend capability alone is not enough to claim a visible product experience.
- Co-presence is not causation. Product movement may inform an owner, but Athena must not be described as automatically calculating a sales-driven replenishment decision.
- Historical comparison means Athena-recorded activity accumulated through use. It does not mean automatic recovery of notebooks or physical receipts from before adoption.
- Unknown, partial, stale, or redacted evidence stays explicit. It is not converted to zero or a confident claim.

## Primary narrative spine

| ID | Stage or transition | Current evidence | What the evidence supports | What it does not support | Audit status |
| --- | --- | --- | --- | --- | --- |
| S1 | Today's sales standing | `src/components/store-pulse/StorePulseSummaryView.tsx`; `src/components/pos/sales-pulse/POSSalesPulseView.test.tsx` | A typed Store Pulse summary presents sales, transactions, average transaction, items sold, and today's completed POS sales. Financial detail is permission-aware. | Accounting-grade financial standing, profit, or sales outside the displayed source/window. | Candidate, pending sanitized fixture and owner review |
| T1 | Today's standing → historical comparison | The same Store Pulse component exposes `today`, `this_week`, `this_month`, and `all_time`, a trend, and prior-window comparison fields. Daily Operations pins operating-date semantics rather than browser wall-clock semantics. | The current period can be placed beside Athena-recorded prior activity without changing the reporting meaning of “today.” | Reconstruction of pre-Athena paper history or predictive forecasts. | Candidate, credible within one surface |
| S2 | Historical comparison | `StorePulseOperatorSnapshot.comparison`, `historyDays`, `usableHistoryDays`, and `trend`; `docs/solutions/architecture/athena-store-pulse-daily-operations-reuse-2026-06-22.md` | Comparison, trend, and limited-history states are real product semantics. | Complete history when the snapshot is limited, redacted, or unavailable. | Candidate, pending public-safe state selection |
| T2 | Historical comparison → product drivers | Store Pulse carries `topItems` alongside comparison and trend in the same typed operator snapshot and presentation. | Visitors can see which products moved in the selected evidence window next to the trend. | A causal statement that a product alone caused the total or trend. | Candidate, credible if composition preserves the common window |
| S3 | Product drivers | `StorePulseSummaryView.tsx` renders top-item name, SKU, quantity, and sales; the fixture test demonstrates a sanitized shape. | Product movement within the Store Pulse window. | Customer proof, a universal “best seller,” or product profitability. | Candidate, pending production-owned fixture |
| T3 | Product drivers → current stock pressure | Store Pulse retains `productSku`; Procurement supports product/SKU search and exposes inventory, sellable availability, planned/inbound cover, vendor context, and status. `reportingSkuInsightProjection` also joins SKU-day, inventory, and procurement evidence internally. | A purpose-built sanitized composition can retain the same SKU identity while moving from sales evidence to current stock context. | The current Store Pulse and Procurement UIs do not visibly hand off to each other as one interaction. The projection is protected and cannot be queried anonymously. | **Blocked for public proof until one same-SKU sanitized composition is reviewed; narrow the transition if that review fails** |
| S4 | Current stock pressure | `src/components/procurement/ProcurementView.tsx`; `convex/stockOps/replenishment.ts` | Current on-hand/available quantities, planned and inbound cover, vendor context, exceptions, and purchase-order state. | A recommendation derived from sales history. Current continuity guidance uses stock and purchase-order context with fixed thresholds/targets. | Candidate, pending sanitized fixture and wording review |
| T4 | Stock pressure → owner-led action | Procurement presents “Add to draft,” vendor assignment, reorder-draft quantities, and draft purchase-order creation from pressure rows. | The owner reviews evidence and chooses whether and how much to place into a vendor-backed draft. | Autonomous purchasing, guaranteed availability, or a claim that Athena chooses the reorder quantity from sales history. | Candidate, credible if owner action remains explicit |
| S5 | Owner-led restocking decision | `ProcurementView.tsx` and purchase-order/receiving workflows | A human can turn reviewed stock context into a draft, follow its status, and track receiving. | Automatic ordering or a guarantee that the decision is optimal. | Candidate, pending product-owner approval |

### Primary-spine decision

The current product supports every individual stage. T1, T2, and T4 have visible product evidence. T3 has a shared SKU identity and internal reporting evidence, but the currently reviewed surfaces do not visibly present the handoff. U5 must either produce one public-safe, same-SKU composition that a product owner approves or narrow the story so it does not imply an existing automatic or in-surface sales-to-replenishment connection.

## Exactly two supporting breadth moments

These are the only breadth moments proposed for the landing narrative. Neither is approved yet.

| Moment | Current evidence | Supported statement boundary | Public-proof requirement | Status |
| --- | --- | --- | --- | --- |
| Cross-channel record connection | `shared/reportingContract.ts` registers both `pos` and `storefront`; `convex/reporting/facts.ts` recognizes POS completions and first storefront fulfillment as canonical commerce facts with explicit channels; `convex/reporting/commerceRecognition.test.ts` covers both paths. | Athena's reporting record can recognize completed in-person POS activity and fulfilled storefront activity under one store reporting model while preserving channel identity. | Use a sanitized, purpose-built readout with non-customer data. Do not reuse the current Orders screenshot, expose a protected reporting query, or imply that Store Pulse itself includes online activity unless its contract changes. | Candidate; no current public-safe visual approved |
| Small-team operational control | `DailyOperationsView.tsx` and `DailyCloseView.tsx` present Opening Handoff, EOD Review, pending approvals, cash variance, completed-close attribution, and manager-approval requirements. `docs/solutions/architecture/athena-pos-closeout-hold-boundary-2026-07-01.md` documents the shared closeout boundary. | A small team can review a store day, see cash-impacting work and approvals, and retain who or what completed the close. | Use a sanitized Daily Operations/EOD state with generic staff labels and no organization/account data. Keep workflow attribution and manager review visible; do not present automation as unattended business control. | Candidate; current pitch image is not public-safe |

## Pitch asset inventory

Source directory inspected: `outputs/019e1a72-462a-79d1-b3b8-06a6ac03e26a/presentations/athena-pitch/assets/`

The directory exists and contains high-resolution and `-clean` PNG captures for Daily Operations, Point of Sale, Procurement, Cash Controls, Analytics/Storefront activity, Service Intake, and Orders, plus `pw-test.png`. The seven `-clean` captures were visually inspected. They are reference material only and are **rejected for direct publication**.

| Source group | Visible public-safety findings | Direct-publication decision |
| --- | --- | --- |
| Daily Operations, POS, Procurement, Cash Controls, Analytics, Service Intake, Orders (`*-clean.png`) | Every reviewed capture exposes the organization name `Wigclub` and a signed-in personal email in the application chrome. | Reject as-is |
| Orders (`07-orders-clean.png`) | Also exposes customer email addresses, order numbers, amounts, payment methods, delivery state, and relative timing. | Reject as-is |
| Analytics (`05-analytics-clean.png`) | Also exposes a real-looking storefront domain and activity counts/history. Its surface is storefront activity, not proof that Store Pulse includes online sales. | Reject as-is |
| Procurement (`03-procurement-clean.png`) | Also exposes product/SKU names, a count of 137 pressure rows, and operational continuity state. Provenance and whether the figures are production or illustrative are not documented here. | Reject as-is |
| Service Intake (`06-service-intake-clean.png`) | Also contains form values and customer-like contact fields. Some appear illustrative, but provenance is not recorded and the signed-in account remains visible. | Reject as-is |
| Full-resolution captures and `pw-test.png` | File presence and dimensions were inspected, but field-by-field visual and provenance audits are not complete in this record. | Reject pending full audit |

Technical inspection established PNG dimensions and RGB/RGBA format. A complete EXIF/XMP/ICC/profile and embedded-string audit has **not** been completed for every file, so metadata safety must not be inferred. Final media must be newly exported under generic landing filenames, stripped of EXIF/XMP/profile data, scanned for embedded external URLs and forbidden strings, and audited independently from the Open Graph image.

## Required final media audit

Create one row per newly exported public file before approval.

| Public filename | Fixture/source revision | Names | Emails/phones | URLs/domains | Amounts/counts provenance | Org/store/account ids | Implied claim | EXIF/XMP/profile stripped | Embedded strings scan | Reviewer/date | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `[none exported]` |  |  |  |  |  |  |  |  |  |  |  |

The Open Graph image requires its own row even if it is derived from an already approved visual.

## Blocking decision

Final proof approval is blocked by all of the following:

1. no accountable product owner is assigned;
2. no public-safe fixture or exported media is approved;
3. the T3 same-SKU product-movement-to-stock-pressure composition has not been reviewed;
4. the exact cross-channel and team-control visuals have not been selected and sanitized;
5. the five-person positioning gate has not run;
6. provenance and metadata audits for the pitch assets are incomplete.

If any stage or transition cannot clear these gates, narrow the landing narrative rather than fabricating connective evidence.

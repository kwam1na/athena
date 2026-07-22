# Shared demo backend coverage

The shared demo is a server-side principal and store mode. Unknown writes and
unknown external effects are denied. UI visibility is not an authorization
control.

Athena's public mutation/action surface is currently classified by the platform
capability catalog in `convex/platform/capabilityCatalog.ts`. Module defaults
cover coherent domains and exact-function overrides separate sensitive
operations such as refunds, destructive administration, terminal registration,
and payment collection. The static coverage test discovers every exported
public Convex mutation and action and fails when any function is unclassified.

The operation-admission migration pairs this platform capability catalog with
public-write structural coverage in `convex/operationAdmission`. Shared demo
consumes that platform catalog through its adapter instead of owning
write-admission proof. Migrated shared-demo writes must now enter through an
operation definition plus adapter-backed admission context. The generic
Athena-user auth helper keeps only the explicit shared-demo read bridge; write
capabilities must enter through operation admission or remain in exact legacy
exemptions until migrated. Remaining legacy write groups stay tracked by
migration inventory and domain-specific policy until they receive operation
definitions.

The demo allowlist is a separate list of capability IDs. Classification does
not grant access: every newly discovered capability remains denied until it is
added to `SHARED_DEMO_ALLOWED_CAPABILITIES` and wired through a store-clamped,
restore-fenced server boundary. `SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY`
records only the residual legacy runtime enforcement bindings; it is not the
capability catalog. Migrated public-write coverage is owned by operation
definitions plus explicit migration exemptions.

## Athena view surfaces

The UI has a separate, presentation-only catalog in
`src/components/shared-demo/sharedDemoSurfaceCatalog.ts`. It assigns every
authenticated route template to an outcome-oriented surface such as POS
checkout, cash register control, order fulfillment, product catalog, reports,
or administration. Surface metadata records whether the intended demo
presentation is interactive, read-only, or observational.

`SHARED_DEMO_VISIBLE_SURFACES` is an explicit allowlist. A route being present
in the catalog does not make it visible, and an unknown route is denied by
default. The focused route coverage test discovers every authenticated route
file and fails if it cannot be classified. Literal route templates take
precedence over parameterized detail templates so a path such as
`products/new` cannot be mistaken for `products/:productSlug`.

The visible demo families are:

- Owner orientation and dashboard
- POS checkout, sales history, expenses, terminal health, and read-only POS
  settings
- Cash register control
- Daily operations, approvals, read-only inventory import, stock activity,
  procurement, and receiving
- Order fulfillment
- Product and complimentary-product browsing
- Storefront context, reviews, customers, and checkout sessions
- Reports and operational observability
- Read-only service intake, appointments, and case work

Organization settings, app and store configuration, members and permissions,
bulk administration, product creation/editing,
archived products, complimentary-product creation, and promotion administration
are cataloged but not visible in the demo. Service catalog administration is
also cataloged separately and hidden.

This surface allowlist is not an authorization boundary. It controls what the
demo presents; the server capability allowlist below remains authoritative for
reads, writes, and external effects.

Existing shared-demo read allowlists are intentionally unchanged by the
operation-admission cleanup. Public reads/queries, public actions, broad
provider dispatch migration, and shared-demo seeding/restore redesign remain
out of scope until separately planned. New or migrated write admission should
not be added back to `convex/lib/athenaUserAuth.ts`; use
`convex/operationAdmission` and the shared-demo operation adapter for migrated
public writes.

## Athena capability families

- Store operations: cash controls, Daily Operations, approvals, expenses,
  staff authentication/management/communication, and store configuration.
- Selling: POS catalog, sales, transaction corrections/voids, customers,
  sessions, synchronization, terminals, and recovery.
- Inventory and supply: catalog, import, adjustments/counts, and procurement.
- Service work: intake, appointments, service catalog, and service cases.
- Commerce: order creation/management/fulfillment/returns, storefront content
  and sessions, reviews, rewards, customer messaging, billing, and refunds.
- Platform: identity, permissions, organizations, integrations, Remote Assist,
  intelligence, reporting, exports, maintenance, destructive administration,
  and demo lifecycle.

## Allowed business capabilities

| Capability | Demo behavior |
| --- | --- |
| POS sale completion | Real shared-store write |
| Inventory adjustment | Real shared-store write |
| Cash control | Real operational write; no money movement |
| Operational approvals | Real manager decisions within the shared store |
| Order fulfillment | Real status write; notification suppressed |
| Staff communication | Real bounded shared message; no identity management |
| Daily Operations | Real store-day start write |
| Reports | Read-only existing projections |
| Staff authentication | Shared manager sign-in and bounded approval proofs |

Identity, permissions, billing, integrations, exports, refunds/payment effects,
destructive administration, and store deletion are denied. The current
shared-demo policy registry is `convex/sharedDemo/policy.ts`; future
public-write authority should be declared in `convex/operationAdmission` and
adapted by `convex/sharedDemo/operationAdapter.ts`.

## External effects

Customer and order notifications return labeled simulated outcomes. Payment,
refund, export, and integration gateways are denied. A shared-demo caller never
receives a live-effect permit and provider secrets are not loaded.

## Restore contract

`sharedDemoRestoreState` is the singleton store lease and monotonic epoch. Every
allowed demo mutation must read it in the same Convex transaction as the
business write through `requireReadySharedDemoWriteWithCtx`. Restore replaces
the versioned baseline rows, verifies expected domain counts, then publishes
`ready`. Hourly and manual callers use the same internal `restoreBaseline`
mutation and idempotency contract.

Every store-scoped demo read or write also compares its target store to the
server-owned principal before ordinary organization authorization runs. A
restore verification, missing-row, or capacity error is intentionally allowed
to escape the Convex mutation so all table replacements roll back atomically.

The baseline capture stores exact source documents and stable IDs for the six
domain tables plus POS and order line items. Restore deletes visitor-added rows,
replaces modified baseline rows, refuses to recreate a destructively removed
protected row, and schedules the existing Reports materializer after source
truth is restored. Adding a new demo-writable source table requires adding it to
`SHARED_DEMO_MUTABLE_TABLES`; the static coverage review treats an omitted table
as a release blocker.

## Provisioning

Run the internal `sharedDemo/provision:provisionSharedDemo` mutation once on the
approved deployment. It is idempotent by the stable organization/store
slugs and returns the Athena user, organization, and store IDs required by the
runtime configuration. It creates the synthetic owner and cashier, catalog and
stock, terminal/register and cash posture, completed sale and line item,
inventory movement, pickup order and line item, a started store day with its
Opening Handoff completed, and operational narrative. Hourly and manual restore
roll that opening state to the current store operating date. Baseline documents
are captured transactionally before the mutation reports `created`; a partial
pre-existing foundation fails closed.

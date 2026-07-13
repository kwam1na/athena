# Shared demo backend coverage

The shared demo is a server-side principal and store mode. Unknown writes and
unknown external effects are denied. UI visibility is not an authorization
control.

The static public-function inventory is intentionally scoped to the staged demo
surface in `SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY`. Its test proves every listed
export exists and every non-read classification is invoked by that module. It
does not claim to enumerate every historical public Convex export in Athena;
new demo-reachable functions must be added to this inventory before release.

## Allowed business capabilities

| Capability | Demo behavior |
| --- | --- |
| POS sale completion | Real shared-store write |
| Inventory adjustment | Real shared-store write |
| Cash control | Real operational write; no money movement |
| Order fulfillment | Real status write; notification suppressed |
| Staff communication | Real bounded shared message; no identity management |
| Daily Operations | Real store-day start write |
| Reports | Read-only existing projections |

Identity, permissions, billing, integrations, exports, refunds/payment effects,
destructive administration, and store deletion are denied. The authoritative
classification registry is `convex/sharedDemo/policy.ts`.

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
approved QA/dev deployment. It is idempotent by the stable organization/store
slugs and returns the Athena user, organization, and store IDs required by the
runtime configuration. It creates the synthetic owner and cashier, catalog and
stock, terminal/register and cash posture, completed sale and line item,
inventory movement, pickup order and line item, open operating day, and
operational narrative. Baseline documents are captured transactionally before
the mutation reports `created`; a partial pre-existing foundation fails closed.

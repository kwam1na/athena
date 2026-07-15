---
title: "POS client→server trust-boundary hardening: server derives, client proposes"
date: 2026-07-15
category: architecture-patterns
module: pos
problem_type: architecture_pattern
component: payments
resolution_type: code_fix
severity: high
applies_when:
  - "Adding or changing an online POS completion path (completeTransaction / createTransactionFromSession / completeSession)"
  - "Trusting any client-supplied money, timestamp, or operating-date value at a server write boundary"
  - "Adding an idempotency guard to a mutation that mints a new record"
  - "Tightening a schema money validator or migrating money to integer minor units"
tags: [pos, trust-boundary, idempotency, re-pricing, pesewas, clock-skew, migration]
delivery_diff_fingerprint: 58c96839fc0d89ba7d1914edbc77dfbf7c106dacdb537cae4f0bb0a8afa493c4
---

# POS client→server trust-boundary hardening: server derives, client proposes

## Problem

The local-first POS trusted terminal-supplied values at the server write boundary: sale line **prices** (recomputed from `item.price`, never compared to catalog authority), **idempotency** (none — a retried completion minted a second sale and double-charged the drawer), business **timestamps / operating dates** (taken from the terminal clock), and **money units** (unconstrained `v.number()`, still stored in cedis). The offline projection path already re-priced and deduped; the online paths did not, so a stale or tampered terminal could sell at an arbitrary price, double-charge, or book a sale into the wrong operating day — with no attribution.

## Solution

Four reusable moves, all applied at the server boundary in `convex/pos/application/commands/completeTransaction.ts` and `convex/pos/application/sync/ingestLocalEvents.ts`:

1. **Server re-pricing (U7).** Derive the authoritative unit price from catalog authority using the exact offline basis `provisional.importedPrice ?? (typeof sku.netPrice === "number" ? sku.netPrice : sku.price)`. A matched line records the derived basis (not the client echo). A deviation returns `approvalRequired(...)` (mirroring `buildVoidApprovalRequirement`, `requiredRole: "manager"`); a valid manager proof (`consumeCommandApprovalProofWithCtx`) accepts the charged price and writes an append-only `operationalEvent` audit. The derived price flows into `posTransactionItem.unitPrice/totalPrice`, reporting `*Minor`, and totals. Lines with their own review provenance (pending-checkout items) are explicitly exempt.

2. **Idempotency at the mint (U8).** Dedup on a client-stable token **before** `generateTransactionNumber`/`createPosTransaction` (keying off the freshly-minted id dedups nothing). Return the original sale on replay (mirrors offline `resolveExistingSaleProjection`). Thread the same token into `recordRegisterSessionSale` at every call site so the drawer cash is guarded by `recordedTransactionKeys`. Namespace online tokens (`online:` / `session:<sessionId>`) so they cannot collide with the offline `localTransactionId` namespace.

3. **Deterministic, retry-safe clock derivation (U9).** `isSameLocalEvent` compares `occurredAt` + `payload`, so **never mutate them**. Instead derive the clamped business time and the server operating date once at first ingest and store them in **additive** record fields (`serverOccurredAt`, `serverOperatingDate`, `clockObservation`) that the retry-match ignores. The store-day projector prefers `serverOperatingDate`. Missing timezone authority falls back to the terminal value with a flag (liveness preserved).

4. **Gated money migration (U10).** POS money was never migrated to pesewas. Land the migration mechanism (deterministic per-row `pesewasMigratedAt` marker + deployment cutoff, replacing the `< 10_000` heuristic) and a verifiable `posAmountMigrationRun` completion marker, but do **not** flip the schema validators — that is a two-phase, prod-orchestrated cutover.

## Why This Matters

Money correctness is not enforceable from the client. Each move keeps the client as a *proposer* and makes the server the *authority*: it recomputes prices, dedups mints, derives dates, and owns money representation. Skipping any one leaves a bypass — e.g. re-pricing only the direct path lets terminals route around it via the session path; keying idempotency off the minted id dedups nothing; clamping `occurredAt` in place silently breaks the sync retry-match.

## Prevention

- Every online completion path (`completeTransaction`, `createTransactionFromSession`, and the real client entry `inventory/posSessions.ts:completeSession`) must apply the same guard — grep for all callers of the shared handler, not just the two cited in a ticket.
- When hardening the offline-equivalent of an online path, treat the offline projector as the *template* (basis, dedup key, conflict discipline) rather than re-deriving.
- Additive record fields are the safe way to attach server-derived attribution without breaking an idempotency/equality check — verify what the equality function compares (`isSameLocalEvent` here) before touching any field.
- Never tighten a schema money validator before a completion-marker query proves every legacy row is migrated against production; keep the flip as a gated follow-up.
- Public Convex modules with exported return validators need a sibling `assertConformsToExportedReturns` proof touched in the same change, or `lint:convex:changed` blocks the push.

## Examples

Idempotency dedup at the mint (both paths), returning the original sale on replay:

```ts
const idempotencyKey = args.idempotencyKey
  ? onlineCompletionIdempotencyKey(args.idempotencyKey) // "online:<token>"
  : undefined;
if (idempotencyKey) {
  const existing = await resolveExistingOnlineCompletion(ctx, { storeId, idempotencyKey });
  if (existing) return ok(existing); // no second mint, no second cash delta
}
```

Retry-safe clock derivation (additive, computed once):

```ts
// occurredAt + payload are UNCHANGED (isSameLocalEvent compares them);
// the clamp/derivation lives in additive fields the retry-match ignores.
const clockAttribution = existing
  ? { serverOccurredAt: existing.serverOccurredAt, serverOperatingDate: existing.serverOperatingDate, clockObservation: existing.clockObservation }
  : await assessServerClock(dependencies.serverClock, { occurredAt, serverTimeAt: acceptedAt, ... });
```

## Related

- V26-1062 (U7 re-pricing), V26-958 (U8 idempotency), V26-1063 (U9 clock), V26-1064 (U10 migration), V26-1066 (U10 constraint-flip follow-up).
- Plan: `docs/plans/2026-07-15-001-fix-pos-local-first-hardening-plan.md`.

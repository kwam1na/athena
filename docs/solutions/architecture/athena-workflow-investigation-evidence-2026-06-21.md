---
title: Athena Workflow Investigation Evidence
date: 2026-06-21
category: architecture
module: athena-webapp
problem_type: cross_domain_workflow_investigation
component: workflow-traces
resolution_type: shared_trace_foundation_plus_source_ledgers
severity: medium
tags:
  - workflow-traces
  - operations
  - observability
  - procurement
  - service-cases
  - online-orders
  - automation
---

# Athena Workflow Investigation Evidence

## Problem

Operators and support need to answer what happened in a workflow that spans more
than one record. POS already had a trace pattern for session and register
lifecycle evidence, but stock receiving, online orders, returns/refunds,
exchanges, service cases, and scheduled jobs still required reconstruction from
source records, operational events, inventory movements, payment allocations,
and cron return values.

The risk is over-correcting by turning workflow traces into a second source of
truth. Trace rows are useful investigation evidence, but they must not replace
domain ledgers, operational events, payment allocations, inventory movements,
`automationRun`, or the owning business records. They also carry cross-domain
references, so dedupe, access, and data minimization have to live in the shared
foundation rather than being reimplemented by each surface.

## Solution

Keep the business mutation authoritative, then write investigation evidence
best-effort through the shared workflow trace foundation.

The shared contract lives in `packages/athena-webapp/shared/workflowTrace.ts`
and `packages/athena-webapp/convex/workflowTraces/core.ts`. Trace ids and lookup
values are normalized centrally, trace details are checked for sensitive raw
payload keys, and `appendWorkflowTraceEventWithCtx` accepts an optional
`eventKey`. When an `eventKey` already exists for the store and trace, the append
returns the existing event instead of creating another timeline row. That makes
receiving retries, order replays, refund retries, and repeated service actions
readable instead of noisy.

Access stays on the read side through
`packages/athena-webapp/convex/workflowTraces/public.ts`. Shared reads accept
workflow-type authorizers so sensitive traces can enforce the same source-record
permission boundary as their originating surface before the reusable trace route
renders evidence. Store access alone is not a reason to expose order, payment,
customer, service-note, or scheduled-run details.

Domain adapters under `packages/athena-webapp/convex/workflowTraces/adapters`
own workflow type names, trace ids, lookup types, titles, subject refs, and
compact summaries. Domain writer modules then call the shared core after the
primary write succeeds and catch trace failures so evidence never blocks the
operator workflow.

Implemented workflow families:

- Stock purchase orders and receiving use
  `convex/workflowTraces/adapters/purchaseOrder.ts` and
  `convex/stockOps/purchaseOrderTracing.ts`. Purchase-order status changes and
  receiving batches create trace milestones, lookup by PO id/number/vendor and
  receiving `submissionKey`, and link source refs such as receiving batch,
  inventory movement, line item, and operational work item ids. The source
  records in `convex/stockOps/purchaseOrders.ts`, `convex/stockOps/receiving.ts`,
  inventory movements, and operational events remain authoritative.
- Online orders use `convex/workflowTraces/adapters/onlineOrder.ts` and
  `convex/storeFront/onlineOrderTracing.ts`. The trace records order creation,
  payment verification, payment collection, and status milestones while lookup
  values include order id, order number, checkout session id, and a safe external
  reference fingerprint instead of raw provider references.
- Returns, refunds, and exchanges use
  `convex/workflowTraces/adapters/orderReturnExchange.ts` as subflows linked to
  the parent online-order trace. Approval, refund reservation/release/finalize,
  restock, replacement, exchange, and balance-collection milestones point back
  to the order and source payment or inventory refs without hiding the base order
  lifecycle.
- Service cases use `convex/workflowTraces/adapters/serviceCase.ts` and
  `convex/serviceOps/serviceCaseTracing.ts`. Intake, appointment conversion,
  line items, approvals, payments, refunds, inventory usage, status changes,
  awaiting pickup, completion, and cancellation become service-case milestones.
  Service case records, service inventory usage, approval requests, payment
  allocations, and operational work items remain the ledgers of record.
- Scheduled cleanup and payment jobs use
  `convex/automation/scheduledRunLedger.ts` for generic cron evidence. The
  ledger records a stable per-window `runKey`, scope, visibility, candidates,
  processed/succeeded/failed/skipped counts, sample subject ids, snapshot counts,
  and error summaries. Policy-backed automation still uses `automationRun`; the
  scheduled-run ledger is for generic job evidence that should not imply policy
  control.

Surface links are read-model additions, not new command centers. Procurement,
receiving, online order activity/refund/return-exchange views, service cases,
and Daily Operations expose links or summaries from their existing records using
the shared trace route and `WorkflowTraceRouteLink`. Empty or missing evidence
means the source record still stands; it does not make the workflow invalid.

## Regression Targets

- Shared workflow trace tests should prove `eventKey` dedupe, lookup
  normalization, schema indexes, presentation ordering, and sensitive-detail
  minimization.
- Domain tracing tests should prove each writer is best-effort: trace failures
  are logged or swallowed without failing purchase-order, receiving, online
  order, return/exchange, service-case, or scheduled-job business results.
- Purchase-order and receiving tests should cover PO status events, receiving
  `submissionKey` dedupe, inventory movement refs, and read-model trace links.
- Online order tests should cover order lifecycle milestones, safe external
  reference fingerprints, return/exchange subflow links, refund/payment refs,
  and order read-model trace ids.
- Service-case tests should cover intake/appointment conversion, approval,
  payment/refund, inventory usage, status milestones, generated lookup refs, and
  service-case read-model trace ids.
- Scheduled-run tests should cover run-window keying, store/system scope,
  operator visibility, counts, support-only rows, no-candidate rows, and partial
  failure rows.
- Surface tests should prove trace links and scheduled-run summaries appear only
  where the current source read model can already expose the underlying record.

## Prevention

- Add workflow traces only for durable lifecycle owners. Use `operationalEvent`
  for discrete command audit rows and source ledgers for financial, inventory,
  stock, and automation facts.
- Keep evidence writes best-effort. A trace, lookup, or scheduled-run ledger
  failure must not turn a successful business mutation into an operator blocker.
- Use stable event keys for retryable milestones. Include the workflow id and
  replay key, such as status, submission key, payment allocation id, refund ref,
  service usage id, or scheduled window.
- Store refs and normalized summaries in trace details. Do not store raw payment
  provider payloads, customer contact details, service notes, or provider error
  bodies.
- Add or reuse workflow-type access authorizers before exposing sensitive traces
  through the reusable public route.
- Prefer existing surface links and read models over a new investigation
  dashboard until source-specific evidence patterns prove insufficient.
- After changing workflow trace schemas, adapters, generated Convex APIs, agent
  docs, or graph files, regenerate through the repo scripts rather than editing
  generated artifacts by hand.

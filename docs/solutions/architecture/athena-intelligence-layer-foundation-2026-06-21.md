---
title: Athena Intelligence Layer Keeps AI State Athena-Owned
date: 2026-06-21
category: architecture
module: athena-webapp
problem_type: intelligence_layer_boundary
component: intelligence
resolution_type: athena_owned_run_artifact_provider_contract
severity: medium
tags:
  - intelligence
  - ai
  - llm
  - convex
  - providers
  - recommendations
---

# Athena Intelligence Layer Keeps AI State Athena-Owned

## Problem

Athena needs proactive recommendations and owner-facing decision support, but
the previous LLM path was a thin provider call that returned provider text and
left insight generation vulnerable to ad hoc JSON parsing, provider-specific
payloads, missing audit state, and unclear authorization. The risk is letting
TanStack AI, a model provider, or a Convex AI component become the durable
business ledger for recommendations, approvals, or future apply actions.

## Solution

Create an Athena-owned intelligence layer in Convex. The layer owns runs,
context snapshots, provider invocations, artifacts, review operations,
authorization checks, normalized errors, source refs, usage/cost metadata, and
stale/superseded state. TanStack AI and provider SDKs sit behind a typed adapter
that returns structured text/JSON outputs and normalized invocation evidence.

The old `convex/llm` modules can remain as temporary compatibility wrappers
while store and user insight panels migrate, but new AI work should enter
through the intelligence capability registry and artifact lifecycle. A
capability captures actor- or policy-visible context, schedules/internalizes
provider work, validates output, persists a reviewable artifact, and records
visible review decisions through existing operational rails.

Runs and artifacts stay separate. Runs record execution state such as queued,
context captured, running, failed, completed, stale, superseded, and rerun
requested. Artifacts record business output state such as draft, ready,
dismissed, invalid, stale, superseded, and failed. This keeps retry evidence,
provider attempts, and human review from overwriting the recommendation record.

## Boundaries

- Athena owns durable business state: intelligence tables, artifacts,
  source refs, visibility, review decisions, operational events, and any future
  apply path.
- TanStack AI and model providers own only adapter mechanics below Athena's
  contract: structured call formatting, provider execution, and normalized
  usage/error metadata.
- Raw provider request/response payloads are omitted by default. If retained for
  support, they must be redacted, server-internal, TTL-bound, excluded from logs
  and UI, and protected by explicit admin/support authorization.
- Context snapshots use the initiating actor or scheduled policy visibility
  boundary. Store access alone is not enough to read an artifact generated from
  higher-privilege financial, procurement, customer, service, or support data.
- Retrieved, customer-authored, store-authored, imported, and operational text
  is untrusted prompt context. It cannot grant tool authority, override policy,
  bypass approvals, reveal hidden data, or change output schema requirements.
- V1 is read/propose only. Model output can create artifacts and
  recommendation fields, but cannot mutate domain records or create operational
  work items.

## Convex AI Components

Convex remains the durable runtime substrate through tables, mutations,
internal/scheduled actions, and reactive queries. V1 does not install Convex
Agent, RAG, or Durable Agents components.

Future use of those components must include package installation,
`convex/convex.config.ts` registration with `app.use(...)`, generated API/codegen
refresh, component-owned table isolation, and tests proving Athena artifacts,
approval state, operational events, and domain records remain the source of
truth. Agent threads, RAG namespaces, and Durable Agent state can support
runtime or retrieval behavior, but they must not replace Athena business
artifacts or apply-side command boundaries.

## Media Adapter Path

Image generation is deferred until the text/proposal foundation is stable. A
future media adapter should store candidates in Athena-owned storage, record
provider/model provenance, prompt/source refs, consent basis, licensing notes,
generated-at time, and review state, then require human review before publishing
to catalog, storefront, product, or marketing surfaces.

Publishing media must use the owning domain command boundary and approval policy
when needed. Candidate review, approval, rejection, and publication state should
remain separate from product records so generated media cannot silently become
live catalog truth.

## Regression Targets

- Capability/provider tests prove provider SDK objects do not leak into domain
  artifacts and fake providers can exercise run lifecycle without real model
  calls.
- Snapshot tests prove POS-only or otherwise lower-privilege actors cannot
  capture or read admin-only context.
- Artifact read tests enforce viewer role, recorded visibility mode, and source
  refs before returning recommendations.
- Prompt-safety tests include malicious snapshot text that asks for hidden data,
  approval bypass, or tool-policy changes.
- Review-operation tests prove dismiss, rerun, stale, and supersede decisions
  are command-result compatible and write only the intended operational events.
- Future Convex Agent/RAG/Durable Agents adoption includes source-of-truth tests
  proving Athena artifacts remain authoritative.

## Prevention

- Route new AI/LLM work through the intelligence layer, not direct
  `convex/llm` provider calls.
- Keep provider-specific code inside provider adapters and store only normalized
  provider evidence.
- Treat tool approval from provider runtimes as a pause signal. Athena
  approvals remain `approval_required`, approval requests, manager proofs, and
  domain command precondition checks.
- Mark stale or limited-evidence recommendations explicitly; do not render them
  as current trusted guidance.
- Defer image generation until Athena-owned storage, provenance, consent, review
  state, and publish gates are implemented together.

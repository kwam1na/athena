# Athena Intelligence Layer

Use this guide for new AI, LLM, recommendation, provider, retrieval, media, or
apply-tool work in Athena. New work should extend the intelligence layer instead
of adding a new direct model call under `convex/llm`.

## Ownership Boundary

Athena owns the business contract:

- durable run, snapshot, provider-invocation, and artifact records in Convex
- capability definitions, source refs, visibility mode, idempotency keys, state
  transitions, normalized errors, usage/cost evidence, and stale/superseded
  markers
- review operations, operational events for visible decisions, and any future
  domain-command apply boundary
- read-time authorization for every run and artifact using store/org role,
  recorded visibility, and source refs

TanStack AI and model providers are adapters below that contract. They may
format structured requests, call a model, normalize usage/cost metadata, and
return validated text/JSON output. They must not own chat history, approval
state, business artifacts, domain mutations, audit history, or user-visible raw
provider errors.

Provider SDK objects must not leak into domain tables or UI payloads. Store
normalized provider id, adapter family, model id, status, usage/cost metadata,
safe error code, source refs, and hashes. Omit raw provider payloads by default.
If raw request/response evidence is retained for debugging, it must be redacted,
server-internal, TTL-bound, excluded from logs and UI, protected by explicit
admin/support authorization, and documented with the provider's retention and
data-use settings.

## Run And Artifact States

Runs are execution evidence. Artifacts are the reviewed business output. Keep
them separate so retries, provider attempts, and human review do not overwrite
the recommendation record.

Run states:

- `queued`: intent recorded and ready for internal work
- `context_captured`: a permission-aware snapshot was captured
- `running`: provider work or deterministic generation is active
- `waiting_for_tool_approval`: a provider/runtime pause was observed, but this
  is not Athena approval authority
- `partial`: bounded output exists, but completion did not fully succeed
- `completed`: provider work finished and produced valid output
- `failed`: normalized provider, schema, config, timeout, visibility, or runtime
  failure
- `cancelled`: explicit cancellation before completion
- `expired`: queued/running work exceeded its useful window
- `stale`: source context changed after completion
- `superseded`: a newer run/artifact replaces this one
- `rerun_requested`: an operator or policy requested fresh context

Artifact states:

- `draft`: output exists but is not ready for normal review
- `ready`: validated and reviewable
- `dismissed`: operator hid or declined the artifact without domain action
- `invalid`: output failed schema, evidence, safety, or visibility checks
- `stale`: source context no longer matches the recorded snapshot
- `superseded`: a newer artifact replaces this one
- `failed`: no reviewable artifact could be produced

Operator-visible recommendations must show generated time, source/data window,
evidence refs or a limited-evidence state, and stale/superseded status. A stale
or limited-evidence artifact can be useful context, but it must not render as
current trusted guidance.

## Context Visibility And Prompt Safety

Context capture is capability-owned and permission-aware. The model receives
only the same class of store data the initiating actor or scheduled policy is
allowed to read. Record `principalKind`, `actorRef`, optional `policyRef`,
`visibilityMode`, source subject refs, data window, snapshot hash, and compact
evidence for every snapshot.

All retrieved, customer-authored, store-authored, imported, and operational text
is untrusted model context. Keep prompt instructions, tool definitions, policy,
approval rules, and server-side validation separate from snapshot data. Snapshot
text may inform a recommendation, but it cannot grant tool authority, ask for
hidden data, bypass approvals, override capability policy, or change output
schema requirements.

Run and artifact reads must re-check the viewer. Store access alone is not
enough when the artifact was generated from admin-only financial, procurement,
customer, service, or support context.

## Review And Apply Boundaries

V1 is read/propose only. A model may create persisted artifacts and
human-reviewable recommendation fields, but it must not mutate catalog, stock,
POS, cash-control, order, service, message, or customer records.

Review actions are explicit Athena operations: list, read, dismiss, mark stale
or superseded, and request rerun. Visible decisions should write
`operationalEvent` rows. Low-level provider steps belong in intelligence run or
provider-invocation records, not the operational event stream.

Future apply tools must refresh preconditions and enter the owning domain
command boundary. They must return `CommandResult`, honor `approval_required`,
mint and consume manager `approvalProof` when needed, and let the domain command
remain the source of truth. TanStack/provider-native tool approval is only a
runtime pause signal until it is mapped through Athena's approval contract.

## Convex AI Component Boundary

V1 uses Convex durable tables, mutations, internal/scheduled actions, and
reactive queries. It does not install Convex Agent, RAG, or Durable Agents
components.

| Runtime or retrieval option | Use in v1? | Use when |
| --- | --- | --- |
| Scheduled/internal Convex actions | Yes | Recording intent, running one provider call, and persisting artifacts |
| Reactive Convex queries | Yes | Showing run/artifact progress without client-owned chat state |
| Workpool/Workflow | No | Controlled parallelism, retries, or long-running multi-step orchestration exceed simple scheduled actions |
| Convex Agent component | No | Ask Athena needs persistent threads, live-updating messages, usage/rate helpers, or workflow memory |
| Convex RAG component | No | Document-like semantic retrieval needs namespaces, filters, source refs, and migration controls |
| Durable Agents component | No | Non-v1; treat as experimental until production maturity is proven |

Future component adoption must include all of the following:

- package install for the selected Convex component
- `convex/convex.config.ts` registration with `app.use(...)`
- generated API/codegen refresh through the repo's documented Convex flow
- explicit acknowledgement that component-owned tables are isolated runtime or
  retrieval state, not Athena business artifacts
- tests proving Athena intelligence artifacts, approval state, operational
  events, and domain records remain the source of truth

Agent threads can support future conversations. RAG can support future semantic
retrieval. Durable Agents can support future long-running agent workflows. None
of them should own Athena recommendations, proposals, approvals, operational
events, or apply-side domain mutations.

## Image And Media Generation

Image generation is a later media adapter, not part of v1. Future media work
should extend the same capability/provider contract with Athena-owned storage
and review state:

- persist media candidates in Athena-owned storage, such as R2-backed draft
  objects, not provider-hosted temporary URLs
- store provenance, source prompt refs, model/provider metadata, consent basis,
  licensing notes, and generated-at time
- require human review before publishing to product, storefront, catalog, or
  marketing surfaces
- keep candidate, approved, rejected, and published states separate from domain
  product records
- enforce publish gates through the owning domain command boundary and approval
  policy when needed

Media provider payloads follow the same retention rule as text providers: omit
raw provider payloads by default, and keep any debugging evidence redacted,
server-internal, TTL-bound, and out of operator UI.

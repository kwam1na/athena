/**
 * Agent harness child tables under the intelligence aggregate.
 *
 * `intelligenceRun` stays the operator-visible business run. Every table here
 * is a child keyed by `runId` plus the minimal investigation keys (store,
 * organization, status, expiry). Runtime-native identifiers (Convex Agent
 * thread/message IDs) are stored only as opaque strings and are never
 * authoritative; adapter kind/version, compatibility epoch/digest, and budget
 * policy are pinned on the immutable grant so audit survives prompt expiry.
 */
import { v } from "convex/values";

import {
  intelligenceErrorValidator,
  intelligencePrincipalKindValidator,
  intelligenceSourceRefValidator,
} from "./intelligence";

export const agentProgramAttemptStatusValidator = v.union(
  v.literal("submitted"),
  v.literal("validating"),
  v.literal("executing"),
  v.literal("result_produced"),
  v.literal("rejected"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const agentCapabilityCallStatusValidator = v.union(
  v.literal("requested"),
  v.literal("admitted"),
  v.literal("executing"),
  v.literal("succeeded"),
  v.literal("partial"),
  v.literal("unavailable"),
  v.literal("denied"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const agentTurnBindingStepValidator = v.union(
  v.literal("intent_recorded"),
  v.literal("runtime_thread_bound"),
  v.literal("runtime_input_saved"),
  v.literal("scheduled"),
  v.literal("running"),
  v.literal("completion_prepared"),
  v.literal("athena_committed"),
  v.literal("runtime_projected"),
);

export const agentRetentionClassValidator = v.union(
  v.literal("short_lived"),
  v.literal("standard"),
);

export const agentEvidenceLifecycleValidator = v.union(
  v.literal("retained"),
  v.literal("expired"),
  v.literal("deleted_by_lifecycle"),
);

export const agentEvidenceStateValidator = v.union(
  v.literal("reconstructible"),
  v.literal("provenance_only"),
  v.literal("evidence_expired"),
  v.literal("evidence_deleted_by_lifecycle"),
);

export const agentRuntimeCleanupStatusValidator = v.union(
  v.literal("not_requested"),
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("failed"),
);

export const agentReplaySubjectKindValidator = v.union(
  v.literal("program_source"),
  v.literal("program_result"),
  v.literal("call_output"),
);

export const agentCallSettlementOutcomeValidator = v.union(
  v.literal("succeeded"),
  v.literal("partial"),
  v.literal("unavailable"),
  v.literal("denied"),
  v.literal("failed"),
  v.literal("timeout"),
  v.literal("canceled"),
);

export const agentBudgetVectorValidator = v.object({
  calls: v.number(),
  rows: v.number(),
  bytes: v.number(),
  costUnits: v.number(),
  elapsedMs: v.number(),
});

export const agentBudgetPolicyValidator = v.object({
  runLimits: agentBudgetVectorValidator,
  attemptLimits: v.optional(agentBudgetVectorValidator),
  maxAttempts: v.number(),
});

const boundedRecordValidator = v.record(v.string(), v.any());

export const agentDelegatedOperatorKindValidator = v.union(
  v.literal("normal_user"),
  v.literal("shared_demo"),
);

/**
 * Delegated-admission provenance pinned on the grant (V26-1262): who
 * delegated, what they held at run start, and the projected capability/field
 * set the run may never exceed. Immutable; every later call intersects the
 * operator's CURRENT authority with this record.
 */
export const agentRunGrantDelegationValidator = v.object({
  operatorKind: agentDelegatedOperatorKindValidator,
  athenaUserId: v.id("athenaUser"),
  authUserId: v.optional(v.id("users")),
  membershipRole: v.string(),
  operationalRoles: v.array(v.string()),
  authorityTier: v.string(),
  heldReadIntents: v.array(v.string()),
  capabilityIds: v.array(v.string()),
  grantedProjectionsByCapability: v.record(v.string(), v.array(v.string())),
  authorityDigest: v.string(),
  authorizationEpoch: v.number(),
  authorizedAt: v.number(),
  admissionPolicyVersion: v.string(),
});

/**
 * Delegated-admission evidence on a capability call (V26-1262): the grant and
 * port identity the call was admitted under, the authority observed at
 * admission, and the release verdict. Never carries result data.
 */
export const agentCallDelegationValidator = v.object({
  grantId: v.id("agentRunGrant"),
  grantDigest: v.string(),
  portKey: v.string(),
  handlerPath: v.string(),
  operatorKind: agentDelegatedOperatorKindValidator,
  actorRef: v.string(),
  authorizationEpoch: v.number(),
  authorityDigest: v.string(),
  grantedProjections: v.array(v.string()),
  admission: v.union(v.literal("authorized"), v.literal("refused")),
  refusal: v.optional(
    v.object({ stage: v.string(), code: v.string(), reason: v.string() }),
  ),
  release: v.optional(
    v.object({
      verdict: v.union(v.literal("released"), v.literal("withheld")),
      reason: v.optional(v.string()),
      authorityShrunk: v.boolean(),
      authorizationEpoch: v.number(),
      at: v.number(),
    }),
  ),
});

/**
 * Immutable context-metadata snapshot: exactly one per run. Only the
 * lifecycle markers (`promptPayloadState`, `lifecycle`) may change after
 * insert; everything else is the audit record of what the run was granted.
 */
export const agentRunGrantSchema = v.object({
  runId: v.id("intelligenceRun"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  initiatingPrincipalKind: intelligencePrincipalKindValidator,
  initiatingActorRef: v.string(),
  grantKind: v.literal("agent_delegation"),
  profileKey: v.string(),
  profileVersion: v.string(),
  packageKeys: v.array(v.string()),
  grantDigest: v.string(),
  registryDigest: v.string(),
  compatibilityEpoch: v.number(),
  compatibilityDigest: v.string(),
  adapterKind: v.string(),
  adapterVersion: v.string(),
  budgetPolicy: agentBudgetPolicyValidator,
  egressClass: v.string(),
  promptPayloadHash: v.string(),
  promptPayloadId: v.optional(v.id("agentPromptPayload")),
  promptPayloadState: v.union(
    v.literal("stored"),
    v.literal("expired"),
    v.literal("deleted_by_lifecycle"),
  ),
  lifecycle: v.union(v.literal("retained"), v.literal("deleted_by_lifecycle")),
  deletedByLifecycleAt: v.optional(v.number()),
  createdAt: v.number(),
  delegation: v.optional(agentRunGrantDelegationValidator),
});

/**
 * The durable turn: one per user turn, one run per turn, many turns per
 * opaque runtime thread. Advances one rung at a time; each rung records the
 * opaque runtime reference the next rung depends on.
 */
export const agentTurnBindingSchema = v.object({
  runId: v.id("intelligenceRun"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  turnIdempotencyKey: v.string(),
  adapterKind: v.string(),
  adapterVersion: v.string(),
  runtimeThreadRef: v.optional(v.string()),
  runtimeInputRef: v.optional(v.string()),
  runtimeScheduleRef: v.optional(v.string()),
  runtimeProjectionRef: v.optional(v.string()),
  preparedCompletionRef: v.optional(v.string()),
  step: agentTurnBindingStepValidator,
  stepUpdatedAt: v.number(),
  stepIdempotencyKey: v.optional(v.string()),
  repairCount: v.number(),
  operatorReleaseCommittedAt: v.optional(v.number()),
  operatorViewedAt: v.optional(v.number()),
  operatorViewedByActorRef: v.optional(v.string()),
  // Turn orchestration additions (V26-1265); all optional so bindings recorded before them stay valid.
  /** Athena-owned thread identity (profile + store + operator + client key); many turns share one. */
  threadKey: v.optional(v.string()),
  /** Opaque runtime turn reference recorded once the adapter started the turn. */
  runtimeTurnRef: v.optional(v.string()),
  /** Server-authored progress milestones (bounded; the only progress the browser sees). */
  progress: v.optional(v.array(v.object({ milestone: v.string(), at: v.number() }))),
  /** Release suppressed after commit because authority shrank before an authorized fetch. */
  releaseSuppressedAt: v.optional(v.number()),
  releaseSuppressedReason: v.optional(v.string()),
  /**
   * Provisional-narrative exposure markers. `provisionalReleasedAt` is set once,
   * by the first stored flush: from then on the draft is presumed to have
   * reached the operator's pane (it cannot be recalled from a screen). The
   * viewed pair is the operator's own first-paint acknowledgement — confirmed
   * receipt, first write wins — paired like `operatorViewedAt`.
   */
  provisionalReleasedAt: v.optional(v.number()),
  provisionalViewedAt: v.optional(v.number()),
  provisionalViewedByActorRef: v.optional(v.string()),
  /** Completion outbox bookkeeping: projection retries after `athena_committed`. */
  outboxAttempts: v.optional(v.number()),
  outboxNextAttemptAt: v.optional(v.number()),
  outboxLastError: v.optional(v.string()),
  /**
   * Set once the turn's provider-spend reservation was released back to the
   * spend windows. The reservation is a fixed amount per turn, so this marker —
   * not the provider-invocation row — is what makes settlement happen exactly
   * once for every terminal outcome, including turns that never reached a
   * provider.
   */
  spendSettledAt: v.optional(v.number()),
  abandonedAt: v.optional(v.number()),
  abandonReason: v.optional(v.string()),
  runtimeCleanupStatus: agentRuntimeCleanupStatusValidator,
  runtimeCleanupAttempts: v.number(),
  runtimeCleanupNextAttemptAt: v.optional(v.number()),
  runtimeCleanupLastError: v.optional(v.string()),
  runtimeCleanupCompletedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** Short-lived prompt/content payload; the grant keeps only its hash. */
export const agentPromptPayloadSchema = v.object({
  runId: v.id("intelligenceRun"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  bindingId: v.id("agentTurnBinding"),
  payloadHash: v.string(),
  payload: boundedRecordValidator,
  byteLength: v.number(),
  egressClass: v.string(),
  retentionClass: v.literal("short_lived"),
  expiresAt: v.number(),
  createdAt: v.number(),
});

/**
 * Provider-egress boundary (V26-1264, plan decision 12): recorded once on the
 * attempt immediately before its `programResult` is attached to a
 * provider-visible tool response, after the authorization epoch was
 * revalidated. `committed` is irreversible — a later revocation cancels and
 * suppresses, but the prior exposure stays recorded truthfully.
 */
export const agentProviderEgressValidator = v.object({
  state: v.union(v.literal("committed"), v.literal("withheld")),
  at: v.number(),
  authorizationEpoch: v.number(),
  reason: v.optional(v.string()),
});

export const agentProgramAttemptSchema = v.object({
  runId: v.id("intelligenceRun"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  attemptIdempotencyKey: v.string(),
  sequence: v.number(),
  status: agentProgramAttemptStatusValidator,
  compatibilityEpoch: v.number(),
  programSourceHash: v.string(),
  programSourceByteLength: v.number(),
  sourcePayloadId: v.optional(v.id("agentReplayPayload")),
  resultHash: v.optional(v.string()),
  resultPayloadId: v.optional(v.id("agentReplayPayload")),
  leaseExpiresAt: v.optional(v.number()),
  charged: agentBudgetVectorValidator,
  cited: v.boolean(),
  error: v.optional(intelligenceErrorValidator),
  startedAt: v.optional(v.number()),
  terminalAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  // Executor additions; all optional so rows written before the executor existed stay valid.
  /** Hash of the exact validated/stripped source the sandbox executed. */
  validatedSourceHash: v.optional(v.string()),
  /** Maximum egress class of every capability input the attempt read. */
  egressClass: v.optional(v.string()),
  /** Aggregate completeness derived from every released input envelope. */
  completeness: v.optional(v.union(v.literal("complete"), v.literal("partial"))),
  providerEgress: v.optional(agentProviderEgressValidator),
});

export const agentCapabilityCallSchema = v.object({
  runId: v.id("intelligenceRun"),
  attemptId: v.id("agentProgramAttempt"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  callIdempotencyKey: v.string(),
  sequence: v.number(),
  capabilityId: v.string(),
  status: agentCapabilityCallStatusValidator,
  normalizedArgsHash: v.string(),
  normalizedArgs: v.optional(boundedRecordValidator),
  reservationId: v.optional(v.id("agentBudgetReservation")),
  reserved: agentBudgetVectorValidator,
  charged: agentBudgetVectorValidator,
  resultHash: v.optional(v.string()),
  observedAt: v.optional(v.number()),
  capturedAt: v.optional(v.number()),
  freshness: v.optional(v.string()),
  completeness: v.optional(v.string()),
  sourceRefs: v.array(intelligenceSourceRefValidator),
  sourceRefCount: v.number(),
  replayPayloadId: v.optional(v.id("agentReplayPayload")),
  outputOmittedReason: v.optional(v.string()),
  denial: v.optional(intelligenceErrorValidator),
  error: v.optional(intelligenceErrorValidator),
  startedAt: v.optional(v.number()),
  terminalAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  delegation: v.optional(agentCallDelegationValidator),
});

/** Run-wide counters: one row per run, updated transactionally. */
export const agentBudgetLedgerSchema = v.object({
  runId: v.id("intelligenceRun"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  limits: agentBudgetVectorValidator,
  attemptLimits: v.optional(agentBudgetVectorValidator),
  maxAttempts: v.number(),
  charged: agentBudgetVectorValidator,
  outstanding: agentBudgetVectorValidator,
  overrun: agentBudgetVectorValidator,
  attemptCount: v.number(),
  reservationCount: v.number(),
  settledCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** One reservation per invocation idempotency key; settled exactly once. */
export const agentBudgetReservationSchema = v.object({
  runId: v.id("intelligenceRun"),
  attemptId: v.id("agentProgramAttempt"),
  callId: v.optional(v.id("agentCapabilityCall")),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  idempotencyKey: v.string(),
  reserved: agentBudgetVectorValidator,
  status: v.union(v.literal("reserved"), v.literal("settled")),
  outcome: v.optional(agentCallSettlementOutcomeValidator),
  charged: v.optional(agentBudgetVectorValidator),
  refunded: v.optional(agentBudgetVectorValidator),
  overrun: v.optional(agentBudgetVectorValidator),
  conservative: v.optional(v.boolean()),
  createdAt: v.number(),
  settledAt: v.optional(v.number()),
});

/** Citation bound to run/attempt/call/result hash; standard (365-day) class. */
export const agentCitationBindingSchema = v.object({
  runId: v.id("intelligenceRun"),
  attemptId: v.id("agentProgramAttempt"),
  callId: v.id("agentCapabilityCall"),
  artifactId: v.id("intelligenceArtifact"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  citationKey: v.string(),
  resultHash: v.string(),
  claimDigest: v.optional(v.string()),
  sourceRef: intelligenceSourceRefValidator,
  replayPayloadId: v.optional(v.id("agentReplayPayload")),
  claimSupportId: v.optional(v.id("agentClaimSupport")),
  /**
   * Immutable authoritative revision the cited source carried (V26-1264);
   * keeps the citation reconstructible after the copied output expires.
   */
  immutableRevisionRef: v.optional(v.string()),
  evidenceLifecycle: agentEvidenceLifecycleValidator,
  retentionClass: v.literal("standard"),
  expiresAt: v.number(),
  lifecycleUpdatedAt: v.optional(v.number()),
  createdAt: v.number(),
});

/**
 * Bounded replay payload: short-lived by default, promoted to the standard
 * class only for finally cited program source/result (never call output).
 */
export const agentReplayPayloadSchema = v.object({
  runId: v.id("intelligenceRun"),
  attemptId: v.optional(v.id("agentProgramAttempt")),
  callId: v.optional(v.id("agentCapabilityCall")),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  subjectKind: agentReplaySubjectKindValidator,
  contentHash: v.string(),
  content: v.any(),
  byteLength: v.number(),
  retentionClass: agentRetentionClassValidator,
  expiresAt: v.number(),
  promotedAt: v.optional(v.number()),
  createdAt: v.number(),
});

/** Deterministic minimal claim-support slice; standard (365-day) class. */
export const agentClaimSupportSchema = v.object({
  runId: v.id("intelligenceRun"),
  citationBindingId: v.id("agentCitationBinding"),
  callId: v.id("agentCapabilityCall"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  extractorKey: v.string(),
  extractorVersion: v.string(),
  slice: boundedRecordValidator,
  sliceHash: v.string(),
  byteLength: v.number(),
  retentionClass: v.literal("standard"),
  expiresAt: v.number(),
  createdAt: v.number(),
});

/** Bounded scratch descriptor; short-lived. */
export const agentScratchDescriptorSchema = v.object({
  runId: v.id("intelligenceRun"),
  attemptId: v.optional(v.id("agentProgramAttempt")),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  scratchKey: v.string(),
  contentHash: v.string(),
  byteLength: v.number(),
  content: v.optional(v.any()),
  retentionClass: v.literal("short_lived"),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * Provisional narrative: the model's thinking-out-loud for ONE live turn,
 * servable only while the run is `running` and still admitted. Delete-only —
 * every terminal cause (clamp, suppression, finalize, scope removal, expiry)
 * removes the row; nothing here is ever retained, projected, cited, or audited.
 * No state column: the run, the binding, and `expiresAt` say everything.
 */
export const agentProvisionalNarrativeSchema = v.object({
  runId: v.id("intelligenceRun"),
  turnBindingId: v.id("agentTurnBinding"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  text: v.string(),
  draftOrdinal: v.number(),
  truncated: v.boolean(),
  egressClass: v.string(),
  retentionClass: v.literal("short_lived"),
  updatedAt: v.number(),
  expiresAt: v.number(),
});

/**
 * Engineer-only turn trace: one row per runtime or host event of one driven
 * turn, in the order the host saw it, with the exact payload — the model's
 * narrative deltas, each tool call's arguments, and the outcome the model
 * received — so a turn can be replayed offline while the agent is being
 * refined (prompts, tool response shapes, retry behaviour).
 *
 * It is the single deliberate exception to "the model's narrative never enters
 * Athena's durable record". It is never projected into thread history, a
 * prompt, a citation, or any operator-admitted query; only internal
 * investigation functions read it. Standard (365-day) class, per-row payload
 * cap, and one environment switch (`AGENT_TURN_TRACE`) that turns capture off.
 */
export const agentTurnTraceEventSchema = v.object({
  runId: v.id("intelligenceRun"),
  turnBindingId: v.id("agentTurnBinding"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  /** `adapter` rows carry the runtime envelope's sequence; `host` rows the host's own counter. */
  source: v.union(v.literal("adapter"), v.literal("host")),
  sequence: v.number(),
  at: v.number(),
  /** The runtime event kind, or a host kind: `tool_dispatch`, `provisional_flush`, `trace_capped`, `turn_report`. */
  kind: v.string(),
  payload: v.any(),
  truncated: v.boolean(),
  /** The full call output / program result, when one was already stored for replay. */
  replayPayloadId: v.optional(v.id("agentReplayPayload")),
  retentionClass: v.literal("standard"),
  expiresAt: v.number(),
  createdAt: v.number(),
});

/**
 * Durable narrative trail: the finished drafts of ONE committed turn, in the
 * order the model wrote them, kept so the operator can still read how Athena
 * got to the answer — after a reload, and from an earlier turn in the thread.
 *
 * It is released and withdrawn WITH the answer: same ownership, same live
 * authority, same suppression, and the committed artifact's own egress class,
 * so the trail can never outrank the answer it accompanies. It is written once,
 * only for a run that reached `completed` with a committed release, and never
 * for a canceled, failed, or refused turn. Nothing projects it into thread
 * history, a prompt, or a citation — the committed answer stays the only
 * checked text and the engineer-only turn trace stays the full record.
 */
export const agentTurnNarrativeTrailSchema = v.object({
  runId: v.id("intelligenceRun"),
  turnBindingId: v.id("agentTurnBinding"),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  /** One entry per draft ordinal, ascending; `truncated` marks a draft cut to fit. */
  entries: v.array(v.object({ draftOrdinal: v.number(), text: v.string(), truncated: v.boolean() })),
  byteLength: v.number(),
  /** Copied from the committed answer's payload, so the read gate is the answer's gate. */
  egressClass: v.string(),
  retentionClass: v.literal("standard"),
  expiresAt: v.number(),
  committedAt: v.number(),
  createdAt: v.number(),
});

export const agentEvidenceAccessAuditSchema = v.object({
  runId: v.id("intelligenceRun"),
  citationBindingId: v.optional(v.id("agentCitationBinding")),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  viewerPrincipalKind: intelligencePrincipalKindValidator,
  viewerActorRef: v.string(),
  purpose: v.string(),
  evidenceState: agentEvidenceStateValidator,
  accessedAt: v.number(),
});

/**
 * Durable enablement switch (V26-1265): one row per profile or capability an
 * operator switched. Profiles are DEFAULT OFF — a profile with no row is
 * disabled for operator turns even when its published lifecycle is `enabled`;
 * the switch can never widen beyond the published baseline.
 */
export const agentEnablementSwitchSchema = v.object({
  subjectKind: v.union(v.literal("profile"), v.literal("capability")),
  subjectKey: v.string(),
  state: v.union(v.literal("enabled"), v.literal("disabled")),
  reason: v.optional(v.string()),
  updatedByActorRef: v.optional(v.string()),
  updatedAt: v.number(),
});

/**
 * Provider-spend window (V26-1265): reserve-then-settle cost units per
 * operator and per store over a UTC day so run creation can enforce a spend
 * ceiling before any provider work, exactly like call budgets do.
 */
export const agentSpendWindowSchema = v.object({
  scopeKey: v.string(),
  windowKey: v.string(),
  reservedCostUnits: v.number(),
  settledCostUnits: v.number(),
  runCount: v.number(),
  updatedAt: v.number(),
});

/** Durable compatibility epoch singleton (per scope key, `global` in v1). */
export const agentCompatibilityEpochSchema = v.object({
  scopeKey: v.string(),
  epoch: v.number(),
  digest: v.string(),
  idempotencyKey: v.string(),
  reason: v.optional(v.string()),
  advancedAt: v.number(),
});

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

export const agentRunStatusValidator = v.union(
  v.literal("queued"),
  v.literal("context_captured"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

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

/** Durable compatibility epoch singleton (per scope key, `global` in v1). */
export const agentCompatibilityEpochSchema = v.object({
  scopeKey: v.string(),
  epoch: v.number(),
  digest: v.string(),
  idempotencyKey: v.string(),
  reason: v.optional(v.string()),
  advancedAt: v.number(),
});

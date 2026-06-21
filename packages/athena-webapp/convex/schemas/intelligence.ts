import { v } from "convex/values";

export const intelligencePrincipalKindValidator = v.union(
  v.literal("athenaUser"),
  v.literal("staffProfile"),
  v.literal("system"),
);

export const intelligenceVisibilityModeValidator = v.union(
  v.literal("store_admin"),
  v.literal("store_staff"),
  v.literal("support"),
);

export const intelligenceRunStatusValidator = v.union(
  v.literal("queued"),
  v.literal("context_captured"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const intelligenceArtifactStatusValidator = v.union(
  v.literal("ready"),
  v.literal("stale"),
  v.literal("superseded"),
  v.literal("dismissed"),
  v.literal("failed"),
);

export const intelligenceArtifactKindValidator = v.union(
  v.literal("store_insights"),
  v.literal("user_insights"),
  v.literal("structured_text"),
);

export const intelligenceProviderStatusValidator = v.union(
  v.literal("started"),
  v.literal("succeeded"),
  v.literal("failed"),
);

export const intelligenceSourceRefValidator = v.object({
  table: v.string(),
  id: v.string(),
  label: v.optional(v.string()),
});

export const intelligenceErrorValidator = v.object({
  code: v.string(),
  message: v.string(),
  retryable: v.optional(v.boolean()),
});

export const intelligenceRunSchema = v.object({
  storeId: v.optional(v.id("store")),
  organizationId: v.optional(v.id("organization")),
  capability: v.string(),
  providerKey: v.string(),
  providerModel: v.optional(v.string()),
  idempotencyKey: v.string(),
  status: intelligenceRunStatusValidator,
  trigger: v.union(
    v.literal("operator"),
    v.literal("automation"),
    v.literal("system"),
    v.literal("compatibility"),
  ),
  principalKind: intelligencePrincipalKindValidator,
  actorRef: v.optional(v.string()),
  policyRef: v.optional(v.string()),
  visibilityMode: intelligenceVisibilityModeValidator,
  sourceRefs: v.array(intelligenceSourceRefValidator),
  dataWindowStartAt: v.optional(v.number()),
  dataWindowEndAt: v.optional(v.number()),
  snapshotHash: v.optional(v.string()),
  contextSnapshotId: v.optional(v.id("intelligenceContextSnapshot")),
  artifactId: v.optional(v.id("intelligenceArtifact")),
  retryOfRunId: v.optional(v.id("intelligenceRun")),
  supersedesRunId: v.optional(v.id("intelligenceRun")),
  attemptCount: v.number(),
  error: v.optional(intelligenceErrorValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const intelligenceContextSnapshotSchema = v.object({
  storeId: v.optional(v.id("store")),
  organizationId: v.optional(v.id("organization")),
  runId: v.id("intelligenceRun"),
  capability: v.string(),
  principalKind: intelligencePrincipalKindValidator,
  actorRef: v.optional(v.string()),
  policyRef: v.optional(v.string()),
  visibilityMode: intelligenceVisibilityModeValidator,
  sourceRefs: v.array(intelligenceSourceRefValidator),
  dataWindowStartAt: v.optional(v.number()),
  dataWindowEndAt: v.optional(v.number()),
  snapshotHash: v.string(),
  payloadSummary: v.record(v.string(), v.any()),
  payloadRedaction: v.optional(v.string()),
  createdAt: v.number(),
});

export const intelligenceArtifactSchema = v.object({
  storeId: v.optional(v.id("store")),
  organizationId: v.optional(v.id("organization")),
  runId: v.id("intelligenceRun"),
  contextSnapshotId: v.id("intelligenceContextSnapshot"),
  capability: v.string(),
  kind: intelligenceArtifactKindValidator,
  subjectTable: v.optional(v.string()),
  subjectId: v.optional(v.string()),
  status: intelligenceArtifactStatusValidator,
  visibilityMode: intelligenceVisibilityModeValidator,
  sourceRefs: v.array(intelligenceSourceRefValidator),
  dataWindowStartAt: v.optional(v.number()),
  dataWindowEndAt: v.optional(v.number()),
  snapshotHash: v.string(),
  title: v.optional(v.string()),
  summary: v.optional(v.string()),
  payload: v.record(v.string(), v.any()),
  evidenceRefs: v.array(intelligenceSourceRefValidator),
  confidence: v.optional(v.number()),
  limitedEvidence: v.optional(v.boolean()),
  dismissedAt: v.optional(v.number()),
  dismissedByActorRef: v.optional(v.string()),
  supersededByArtifactId: v.optional(v.id("intelligenceArtifact")),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const intelligenceProviderInvocationSchema = v.object({
  storeId: v.optional(v.id("store")),
  organizationId: v.optional(v.id("organization")),
  runId: v.id("intelligenceRun"),
  contextSnapshotId: v.optional(v.id("intelligenceContextSnapshot")),
  providerKey: v.string(),
  providerModel: v.optional(v.string()),
  capability: v.string(),
  status: intelligenceProviderStatusValidator,
  requestSummary: v.record(v.string(), v.any()),
  responseSummary: v.optional(v.record(v.string(), v.any())),
  rawPayloadStored: v.boolean(),
  error: v.optional(intelligenceErrorValidator),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
});

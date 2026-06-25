import { v } from "convex/values";

import {
  intelligenceSourceRefValidator,
  intelligenceVisibilityModeValidator,
} from "./intelligence";

export const contextTrackingSurfaceValidator = v.union(
  v.literal("storefront"),
  v.literal("athena_webapp"),
);

export const contextEventStatusValidator = v.union(
  v.literal("recorded"),
  v.literal("rejected"),
);

export const contextRetentionClassValidator = v.union(
  v.literal("short_lived"),
  v.literal("standard"),
  v.literal("diagnostic"),
);

export const historicalContextImportStatusValidator = v.union(
  v.literal("active"),
  v.literal("quarantined"),
  v.literal("revoked"),
);

export const historicalContextImportRunStatusValidator = v.union(
  v.literal("dry_run_recorded"),
  v.literal("write_planned"),
  v.literal("write_applied"),
  v.literal("quarantined"),
  v.literal("revoked"),
);

export const contextActorRefValidator = v.object({
  kind: v.union(
    v.literal("athenaUser"),
    v.literal("staffProfile"),
    v.literal("storefrontUser"),
    v.literal("guest"),
    v.literal("system"),
  ),
  id: v.optional(v.string()),
  label: v.optional(v.string()),
});

export const contextSessionRefValidator = v.object({
  kind: v.union(
    v.literal("browser_session"),
    v.literal("storefront_session"),
    v.literal("athena_webapp_session"),
  ),
  id: v.string(),
});

export const contextSubjectRefValidator = v.object({
  type: v.string(),
  id: v.string(),
  label: v.optional(v.string()),
});

export const contextEnvironmentValidator = v.object({
  deviceClass: v.optional(
    v.union(
      v.literal("mobile"),
      v.literal("tablet"),
      v.literal("desktop"),
      v.literal("bot"),
      v.literal("unknown"),
    ),
  ),
  browserFamily: v.optional(
    v.union(
      v.literal("chrome"),
      v.literal("safari"),
      v.literal("firefox"),
      v.literal("edge"),
      v.literal("other"),
      v.literal("unknown"),
    ),
  ),
  osFamily: v.optional(
    v.union(
      v.literal("ios"),
      v.literal("android"),
      v.literal("macos"),
      v.literal("windows"),
      v.literal("linux"),
      v.literal("other"),
      v.literal("unknown"),
    ),
  ),
  viewportBucket: v.optional(
    v.union(
      v.literal("sm"),
      v.literal("md"),
      v.literal("lg"),
      v.literal("xl"),
      v.literal("unknown"),
    ),
  ),
});

export const contextEventAppendArgsValidator = {
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  surface: contextTrackingSurfaceValidator,
  eventId: v.string(),
  schemaVersion: v.number(),
  idempotencyKey: v.string(),
  occurredAt: v.number(),
  origin: v.optional(v.string()),
  payload: v.record(v.string(), v.any()),
  actorRef: v.optional(contextActorRefValidator),
  sessionRef: v.optional(contextSessionRefValidator),
  primarySubject: v.optional(contextSubjectRefValidator),
  subjectRefs: v.optional(v.array(contextSubjectRefValidator)),
  sourceRefs: v.optional(v.array(intelligenceSourceRefValidator)),
  visibilityMode: intelligenceVisibilityModeValidator,
  retentionClass: contextRetentionClassValidator,
  environment: v.optional(contextEnvironmentValidator),
  synthetic: v.optional(v.boolean()),
  abusePartitionKey: v.optional(v.string()),
  historicalImportRunId: v.optional(v.string()),
  historicalImportBatchId: v.optional(v.string()),
  historicalImportStatus: v.optional(historicalContextImportStatusValidator),
  nonCompilable: v.optional(v.boolean()),
};

export const contextEventSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  surface: contextTrackingSurfaceValidator,
  eventId: v.string(),
  schemaVersion: v.number(),
  idempotencyKey: v.string(),
  envelopeHash: v.string(),
  payloadHash: v.string(),
  occurredAt: v.number(),
  receivedAt: v.number(),
  origin: v.optional(v.string()),
  status: contextEventStatusValidator,
  rejectionCode: v.optional(v.string()),
  rejectionMessage: v.optional(v.string()),
  nonCompilable: v.boolean(),
  payload: v.record(v.string(), v.any()),
  actorRef: v.optional(contextActorRefValidator),
  actorRefKind: v.optional(v.string()),
  actorRefId: v.optional(v.string()),
  sessionRefKind: v.optional(v.string()),
  sessionRefId: v.optional(v.string()),
  primarySubjectType: v.optional(v.string()),
  primarySubjectId: v.optional(v.string()),
  subjectRefs: v.array(contextSubjectRefValidator),
  sourceRefs: v.array(intelligenceSourceRefValidator),
  visibilityMode: intelligenceVisibilityModeValidator,
  retentionClass: contextRetentionClassValidator,
  environment: v.optional(contextEnvironmentValidator),
  synthetic: v.optional(v.boolean()),
  abusePartitionKey: v.optional(v.string()),
  historicalImportRunId: v.optional(v.string()),
  historicalImportBatchId: v.optional(v.string()),
  historicalImportStatus: v.optional(historicalContextImportStatusValidator),
  importedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
});

export const contextEventImportRunSchema = v.object({
  importRunId: v.string(),
  importBatchId: v.optional(v.string()),
  runKey: v.string(),
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  mode: v.union(v.literal("dry_run"), v.literal("write")),
  status: historicalContextImportRunStatusValidator,
  windowStartAt: v.optional(v.number()),
  windowEndAt: v.optional(v.number()),
  cursor: v.optional(v.string()),
  nextCursor: v.optional(v.string()),
  reviewedMappingApproval: v.optional(
    v.object({
      approvedBy: v.string(),
      approvedAt: v.number(),
      mappingVersion: v.string(),
    }),
  ),
  report: v.record(v.string(), v.any()),
  quarantineReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

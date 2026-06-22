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
  synthetic: v.optional(v.boolean()),
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
  sessionRefKind: v.optional(v.string()),
  sessionRefId: v.optional(v.string()),
  primarySubjectType: v.optional(v.string()),
  primarySubjectId: v.optional(v.string()),
  subjectRefs: v.array(contextSubjectRefValidator),
  sourceRefs: v.array(intelligenceSourceRefValidator),
  visibilityMode: intelligenceVisibilityModeValidator,
  retentionClass: contextRetentionClassValidator,
  synthetic: v.optional(v.boolean()),
  expiresAt: v.optional(v.number()),
});

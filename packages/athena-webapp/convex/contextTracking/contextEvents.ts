import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import {
  contextEventAppendArgsValidator,
  contextEventStatusValidator,
} from "../schemas/contextTracking";
import { buildSnapshotHash } from "../intelligence/capabilities/insights";
import {
  findRegisteredContextEvent,
  validateRegisteredContextEventPayload,
} from "./eventDefinitions";

const ABUSE_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_ABUSE_WINDOW = 120;

export function isContextEventWriteQuotaExceeded(recentEventCount: number) {
  return recentEventCount >= MAX_EVENTS_PER_ABUSE_WINDOW;
}

export function selectContextEventAppendQuotaDecision(input: {
  abusePartitionKey?: string;
  recentEventCount: number;
}) {
  if (!input.abusePartitionKey) return "skip_quota_check";
  return isContextEventWriteQuotaExceeded(input.recentEventCount)
    ? "reject_quota_exceeded"
    : "allow_write";
}

export function buildContextEventSemanticEnvelopeHash(args: {
  payload: Record<string, unknown>;
  [key: string]: unknown;
}) {
  const payloadHash = buildSnapshotHash(args.payload);

  return buildSnapshotHash({
    ...args,
    occurredAt: undefined,
    payloadHash,
    payload: undefined,
  });
}

export const appendContextEvent = internalMutation({
  args: contextEventAppendArgsValidator,
  returns: v.object({
    kind: v.union(
      v.literal("recorded"),
      v.literal("duplicate"),
      v.literal("rejected"),
      v.literal("idempotency_conflict"),
    ),
    contextEventId: v.optional(v.id("contextEvent")),
    status: v.optional(contextEventStatusValidator),
    message: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const registration = findRegisteredContextEvent(args);
    if (!registration) {
      return { kind: "rejected" as const, message: "Unknown context event." };
    }

    const validation = validateRegisteredContextEventPayload(
      registration,
      args.payload,
    );
    if (!validation.ok) {
      return { kind: "rejected" as const, message: validation.message };
    }

    const payloadHash = buildSnapshotHash(args.payload);
    const envelopeHash = buildContextEventSemanticEnvelopeHash(args);

    const existing = await ctx.db
      .query("contextEvent")
      .withIndex("by_storeId_surface_idempotencyKey", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("surface", args.surface)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .first();

    if (existing) {
      if (
        existing.payloadHash === payloadHash &&
        existing.envelopeHash === envelopeHash
      ) {
        return {
          kind: "duplicate" as const,
          contextEventId: existing._id,
          status: existing.status,
        };
      }

      return {
          kind: "idempotency_conflict" as const,
        contextEventId: existing._id,
        status: existing.status,
        message: "Context event idempotency key already exists with different content.",
      };
    }

    if (args.abusePartitionKey) {
      const recentEvents = await ctx.db
        .query("contextEvent")
        .withIndex("by_storeId_surface_status_occurredAt", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("surface", args.surface)
            .eq("status", "recorded"),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("abusePartitionKey"), args.abusePartitionKey),
            q.gte(q.field("receivedAt"), Date.now() - ABUSE_WINDOW_MS),
          ),
        )
        .take(MAX_EVENTS_PER_ABUSE_WINDOW + 1);

      if (
        selectContextEventAppendQuotaDecision({
          abusePartitionKey: args.abusePartitionKey,
          recentEventCount: recentEvents.length,
        }) === "reject_quota_exceeded"
      ) {
        return {
          kind: "rejected" as const,
          message: "Context event write quota exceeded.",
        };
      }
    }

    const now = Date.now();
    const contextEventId = await ctx.db.insert("contextEvent", {
      storeId: args.storeId,
      organizationId: args.organizationId,
      surface: args.surface,
      eventId: args.eventId,
      schemaVersion: args.schemaVersion,
      idempotencyKey: args.idempotencyKey,
      envelopeHash,
      payloadHash,
      occurredAt: args.occurredAt,
      receivedAt: now,
      origin: args.origin,
      status: "recorded",
      nonCompilable: args.nonCompilable ?? false,
      payload: args.payload,
      actorRef: args.actorRef,
      actorRefKind: args.actorRef?.kind,
      actorRefId: args.actorRef?.id,
      sessionRefKind: args.sessionRef?.kind,
      sessionRefId: args.sessionRef?.id,
      primarySubjectType: args.primarySubject?.type,
      primarySubjectId: args.primarySubject?.id,
      subjectRefs: args.subjectRefs ?? [],
      sourceRefs:
        args.sourceRefs?.map((sourceRef) => ({
          ...sourceRef,
          surface: sourceRef.surface ?? args.surface,
          eventId: sourceRef.eventId ?? args.eventId,
          schemaVersion: sourceRef.schemaVersion ?? args.schemaVersion,
        })) ?? [],
      visibilityMode: registration.visibilityMode,
      retentionClass: registration.retentionClass,
      synthetic: args.synthetic,
      abusePartitionKey: args.abusePartitionKey,
      historicalImportRunId: args.historicalImportRunId,
      historicalImportBatchId: args.historicalImportBatchId,
      historicalImportStatus: args.historicalImportStatus,
      importedAt: args.historicalImportRunId ? now : undefined,
      expiresAt:
        registration.retentionClass === "short_lived"
          ? now + 1000 * 60 * 60 * 24 * 30
          : undefined,
    });

    return { kind: "recorded" as const, contextEventId, status: "recorded" as const };
  },
});

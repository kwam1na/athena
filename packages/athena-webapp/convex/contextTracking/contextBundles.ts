import { v } from "convex/values";

import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildContextEventSourceRefs,
  buildSnapshotHash,
  buildStoreInsightsPromptFromContextEvents,
  buildUserInsightsPromptFromContextEvents,
  type ContextPromptRecord,
} from "../intelligence/capabilities/insights";
import {
  findRegisteredContextEvent,
  validateRegisteredContextEventPayload,
} from "./eventDefinitions";
import type { CompiledContextBundle } from "./types";

const MAX_CONTEXT_EVENTS = 250;
const UNSAFE_PAYLOAD_KEY_PATTERN =
  /(email|phone|contact|payment|card|token|auth|proof|pin|password|secret|user.?agent|url|query|error|message|reason|text|note|comment)/i;

export const compileStoreInsightsContextBundle = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<CompiledContextBundle> => {
    const contextEvents = await ctx.db
      .query("contextEvent")
      .withIndex("by_storeId_surface_status_occurredAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("surface", "storefront")
          .eq("status", "recorded"),
      )
      .order("desc")
      .take(MAX_CONTEXT_EVENTS);

    return buildStoreInsightsContextBundleFromContextEvents(contextEvents);
  },
});

export const compileUserInsightsContextBundle = internalQuery({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args): Promise<CompiledContextBundle> => {
    await assertActorMatchesStore(ctx, args.storeFrontUserId, args.storeId);
    const actorKind = getStorefrontActorTable(ctx, args.storeFrontUserId);
    const actorId = String(args.storeFrontUserId);

    const contextEvents = await ctx.db
      .query("contextEvent")
      .withIndex("by_storeId_surface_actor_status_occurredAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("surface", "storefront")
          .eq("actorRefKind", actorKind)
          .eq("actorRefId", actorId)
          .eq("status", "recorded"),
      )
      .order("desc")
      .take(MAX_CONTEXT_EVENTS);

    return buildUserInsightsContextBundleFromContextEvents(contextEvents, {
      table: actorKind,
      id: actorId,
    });
  },
});

export function buildStoreInsightsContextBundleFromContextEvents(
  contextEvents: Doc<"contextEvent">[],
): CompiledContextBundle {
  const compiled = compileContextEventsWithReport(contextEvents);
  const built = buildStoreInsightsPromptFromContextEvents(compiled.promptRows);
  const sourceRefs = buildContextEventSourceRefs(compiled.promptRows);

  return buildCompiledContextBundle({
    bundleKind: "store_insights_context",
    promptSnapshot: built.snapshot,
    sourceRefs,
    sourceRowCount: contextEvents.length,
    compiledRowCount: compiled.promptRows.length,
    omittedEvidenceCount: compiled.omittedEvidenceCount,
    qualityFlags: compiled.qualityFlags,
    dataWindow: getDataWindow(compiled.promptRows),
  });
}

export function buildUserInsightsContextBundleFromContextEvents(
  contextEvents: Doc<"contextEvent">[],
  actorSourceRef: { table: string; id: string },
): CompiledContextBundle {
  const compiled = compileContextEventsWithReport(contextEvents);
  const built = buildUserInsightsPromptFromContextEvents(compiled.promptRows);
  const contextEventRefs = buildContextEventSourceRefs(compiled.promptRows);

  return buildCompiledContextBundle({
    bundleKind: "user_insights_context",
    promptSnapshot: built.snapshot,
    sourceRefs: [actorSourceRef, ...contextEventRefs],
    sourceRowCount: contextEvents.length,
    compiledRowCount: compiled.promptRows.length,
    omittedEvidenceCount: compiled.omittedEvidenceCount,
    qualityFlags: compiled.qualityFlags,
    dataWindow: getDataWindow(compiled.promptRows),
    sourceRefOffset: 1,
  });
}

function buildCompiledContextBundle(input: {
  bundleKind: "store_insights_context" | "user_insights_context";
  promptSnapshot: Record<string, unknown>;
  sourceRefs: Array<{ table: string; id: string; label?: string }>;
  sourceRowCount: number;
  compiledRowCount: number;
  omittedEvidenceCount: number;
  qualityFlags: string[];
  dataWindow: ReturnType<typeof getDataWindow>;
  sourceRefOffset?: number;
}): CompiledContextBundle {
  const evidenceRefCount = Math.max(0, input.sourceRefs.length - (input.sourceRefOffset ?? 0));
  const qualityFlags =
    input.compiledRowCount === 0
      ? ["no_storefront_context", ...input.qualityFlags]
      : ["context_events_compiled", ...input.qualityFlags];

  return {
    bundleKind: input.bundleKind,
    bundleVersion: 1,
    freshness: input.compiledRowCount === 0 ? "partial" : "current",
    snapshotHash: buildSnapshotHash(input.promptSnapshot),
    payloadSummary: input.promptSnapshot,
    payloadRedaction: "context events compacted; unsafe fields omitted",
    sourceRefs: input.sourceRefs,
    ...input.dataWindow,
    hiddenSourceCount: Math.max(0, input.sourceRowCount - evidenceRefCount),
    omittedEvidenceCount: input.omittedEvidenceCount,
    redactionMode: "compact_no_contact_fields",
    qualityFlags: [...new Set(qualityFlags)],
    limitedEvidence: input.compiledRowCount === 0,
  };
}

function compileContextEventsWithReport(contextEvents: Doc<"contextEvent">[]) {
  const promptRows: ContextPromptRecord[] = [];
  let omittedEvidenceCount = 0;
  let historicalContextCount = 0;

  for (const event of contextEvents) {
    const promptRow = compileContextEvent(event);
    if (!promptRow) {
      omittedEvidenceCount += 1;
      continue;
    }
    if (isHistoricalContextEvent(event)) historicalContextCount += 1;
    promptRows.push(promptRow);
  }

  const qualityFlags: string[] = [];
  if (omittedEvidenceCount > 0) qualityFlags.push("context_events_omitted");
  if (historicalContextCount > 0) qualityFlags.push("historical_context_included");
  if (promptRows.length > 0 && promptRows.length < contextEvents.length) {
    qualityFlags.push("limited_storefront_context");
  }

  return { promptRows, omittedEvidenceCount, qualityFlags };
}

function compileContextEvent(event: Doc<"contextEvent">): ContextPromptRecord | null {
  if (
    event.surface !== "storefront" ||
    event.status !== "recorded" ||
    event.nonCompilable ||
    event.synthetic ||
    event.historicalImportStatus === "quarantined" ||
    event.historicalImportStatus === "revoked"
  ) {
    return null;
  }

  const registration = findRegisteredContextEvent({
    surface: event.surface,
    eventId: event.eventId,
    schemaVersion: event.schemaVersion,
  });
  if (!registration) return null;

  const payload = sanitizeContextEventPayload(event.payload, registration.allowedPayloadKeys);
  if (!validateRegisteredContextEventPayload(registration, payload).ok) return null;

  return {
    _id: String(event._id),
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    eventId: event.eventId,
    contextSchemaVersion: event.schemaVersion,
    actorRef: event.actorRef
      ? { kind: event.actorRef.kind, id: event.actorRef.id }
      : undefined,
    sessionRef:
      event.sessionRefKind && event.sessionRefId
        ? { kind: event.sessionRefKind, id: event.sessionRefId }
        : undefined,
    primarySubject:
      event.primarySubjectType && event.primarySubjectId
        ? { type: event.primarySubjectType, id: event.primarySubjectId }
        : undefined,
    environment: event.environment,
    payload,
  };
}

function sanitizeContextEventPayload(
  payload: Record<string, unknown>,
  allowedPayloadKeys: readonly string[],
) {
  const sanitized: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!allowedPayloadKeys.includes(key)) continue;
    if (UNSAFE_PAYLOAD_KEY_PATTERN.test(key)) continue;
    if (!isPromptSafePayloadValue(value)) continue;

    const sanitizedValue = sanitizeContextEventPayloadValue(key, value);
    if (sanitizedValue !== undefined) sanitized[key] = sanitizedValue;
  }

  return sanitized;
}

function sanitizeContextEventPayloadValue(key: string, value: unknown) {
  if (typeof value === "string") {
    if (key === "route") return sanitizePathname(value);
    if (key === "referrer") return sanitizeOrigin(value);
    return value.slice(0, 120);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;

  return undefined;
}

function sanitizePathname(value: string) {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed, "https://storefront.local");
    return parsed.pathname || "/";
  } catch {
    return trimmed.split(/[?#]/, 1)[0]?.slice(0, 120) || "/";
  }
}

function sanitizeOrigin(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function isPromptSafePayloadValue(value: unknown) {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean" ||
    value === null
  );
}

function isHistoricalContextEvent(event: Doc<"contextEvent">) {
  if (event.historicalImportRunId) return true;

  return event.sourceRefs.some(
    (sourceRef) =>
      sourceRef.table === "analytics" ||
      sourceRef.label === "historical_context_imported" ||
      sourceRef.label === "historical_context_partial" ||
      sourceRef.label === "historical_context_stale",
  );
}

function contextEventMatchesActor(
  event: Doc<"contextEvent">,
  actorId: Id<"storeFrontUser"> | Id<"guest">,
) {
  const id = String(actorId);

  if (event.actorRef?.id === id) return true;
  if (event.primarySubjectId === id) return true;
  return event.subjectRefs.some((subjectRef) => subjectRef.id === id);
}

async function assertActorMatchesStore(
  ctx: QueryCtx,
  actorId: Id<"storeFrontUser"> | Id<"guest">,
  storeId: Id<"store">,
) {
  const actor = await getStoreFrontActorById(ctx, actorId);
  if (!actor || String(actor.storeId) !== String(storeId)) {
    throw new Error("Customer activity is not available for this store.");
  }
}

function getStorefrontActorTable(
  ctx: QueryCtx,
  actorId: Id<"storeFrontUser"> | Id<"guest">,
) {
  return ctx.db.normalizeId("guest", actorId) ? "guest" : "storeFrontUser";
}

async function getStoreFrontActorById(
  ctx: QueryCtx,
  actorId: Id<"storeFrontUser"> | Id<"guest">,
) {
  const storeFrontUserId = ctx.db.normalizeId("storeFrontUser", actorId);
  if (storeFrontUserId) {
    const user = await ctx.db.get("storeFrontUser", storeFrontUserId);
    if (user) return user;
  }

  const guestId = ctx.db.normalizeId("guest", actorId);
  if (guestId) {
    return await ctx.db.get("guest", guestId);
  }

  return null;
}

function getDataWindow(contextEvents: Array<Pick<ContextPromptRecord, "occurredAt">>) {
  if (contextEvents.length === 0) return {};

  const times = contextEvents.map((item) => item.occurredAt);

  return {
    dataWindowStartAt: Math.min(...times),
    dataWindowEndAt: Math.max(...times),
  };
}

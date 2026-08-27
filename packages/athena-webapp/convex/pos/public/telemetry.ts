import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../../platform/operationAdmission";
import { listPosClientEventsReadDefinition } from "../../operationAdmission/readDefinitions";
import { recordPosClientEventsOperationDefinition } from "../../operationAdmission/domains/pos_definitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../../operationAdmission/types";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { isAthenaUnauthenticatedError } from "../../lib/athenaUnauthenticated";
import { ok, userError } from "../../../shared/commandResult";
import {
  posDiagnosticClassificationValidator,
  posDiagnosticRouteIdValidator,
  posDiagnosticSourceValidator,
  posClientEventFlowValidator,
  posClientEventLevelValidator,
  posClientEventMetadataValueValidator,
} from "../../schemas/pos/posClientEvent";
import {
  POS_DIAGNOSTIC_DISPLAY_COPY,
  POS_DIAGNOSTIC_ERROR_NAMES,
  isPosDiagnosticClassification,
  isPosDiagnosticOperation,
  normalizePosDiagnosticBuildIdentifier,
  normalizePosDiagnosticIdentifier,
  normalizePosDiagnosticSource,
  sanitizePosDiagnosticMetadata,
  type PosDiagnosticClassification,
  type PosDiagnosticErrorName,
  type PosDiagnosticOperation,
  type PosDiagnosticRouteId,
  type PosDiagnosticSource,
} from "../../../shared/posDiagnosticRedaction";

export const POS_CLIENT_EVENT_MAX_BATCH = 50;
export const POS_CLIENT_EVENT_MAX_MESSAGE_LENGTH = 500;
export const POS_CLIENT_EVENT_MAX_STACK_LENGTH = 4000;
export const POS_CLIENT_EVENT_MAX_METADATA_KEYS = 20;
export const POS_CLIENT_EVENT_MAX_METADATA_VALUE_LENGTH = 300;

const legacyClientEventInputValidator = v.object({
  clientEventId: v.string(),
  level: posClientEventLevelValidator,
  flow: posClientEventFlowValidator,
  message: v.string(),
  occurredAt: v.number(),
  localRegisterSessionId: v.optional(v.string()),
  errorName: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  errorStack: v.optional(v.string()),
  appVersion: v.optional(v.string()),
  metadata: v.record(v.string(), posClientEventMetadataValueValidator),
});

const v2ClientEventInputValidator = v.object({
  version: v.literal(2),
  clientEventId: v.string(),
  level: posClientEventLevelValidator,
  flow: posClientEventFlowValidator,
  classification: posDiagnosticClassificationValidator,
  occurredAt: v.number(),
  routeId: posDiagnosticRouteIdValidator,
  online: v.boolean(),
  localRegisterSessionId: v.optional(v.string()),
  operation: v.optional(v.string()),
  errorName: v.optional(v.string()),
  source: v.optional(posDiagnosticSourceValidator),
  appVersion: v.optional(v.string()),
  buildSha: v.optional(v.string()),
  metadata: v.record(v.string(), posClientEventMetadataValueValidator),
});

const clientEventInputValidator = v.union(
  legacyClientEventInputValidator,
  v2ClientEventInputValidator,
);

type LegacyClientEventInput = {
  clientEventId: string;
  level: Doc<"posClientEvent">["level"];
  flow: Doc<"posClientEvent">["flow"];
  message: string;
  occurredAt: number;
  localRegisterSessionId?: string;
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  appVersion?: string;
  metadata: Record<string, string | number | boolean>;
};

type V2ClientEventInput = {
  version: 2;
  clientEventId: string;
  level: Doc<"posClientEvent">["level"];
  flow: Doc<"posClientEvent">["flow"];
  classification: PosDiagnosticClassification;
  occurredAt: number;
  routeId: PosDiagnosticRouteId;
  online: boolean;
  localRegisterSessionId?: string;
  operation?: string;
  errorName?: string;
  source?: PosDiagnosticSource;
  appVersion?: string;
  buildSha?: string;
  metadata: Record<string, string | number | boolean>;
};

type ClientEventInput = LegacyClientEventInput | V2ClientEventInput;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export function sanitizeClientEventMetadata(
  metadata: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(sanitized).length >= POS_CLIENT_EVENT_MAX_METADATA_KEYS) {
      break;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      continue;
    }
    sanitized[truncate(key, 100)] =
      typeof value === "string"
        ? truncate(value, POS_CLIENT_EVENT_MAX_METADATA_VALUE_LENGTH)
        : value;
  }
  return sanitized;
}

function normalizeWireEvent(event: ClientEventInput) {
  if (!isFiniteOccurrenceTime(event.occurredAt)) return null;
  if ("version" in event && event.version === 2) {
    if (
      !normalizePosDiagnosticIdentifier(event.clientEventId) ||
      !isPosDiagnosticClassification(event.classification) ||
      (event.operation !== undefined &&
        !isPosDiagnosticOperation(event.operation)) ||
      (event.errorName !== undefined &&
        !(POS_DIAGNOSTIC_ERROR_NAMES as readonly string[]).includes(
          event.errorName,
        )) ||
      (event.localRegisterSessionId !== undefined &&
        !normalizePosDiagnosticIdentifier(event.localRegisterSessionId))
    ) {
      return null;
    }
    const source = event.source
      ? normalizePosDiagnosticSource(event.source)
      : undefined;
    if (event.source && !source) return null;
    const appVersion = normalizePosDiagnosticBuildIdentifier(event.appVersion);
    const buildSha = normalizePosDiagnosticBuildIdentifier(event.buildSha);
    if (event.appVersion && !appVersion) return null;
    if (event.buildSha && !buildSha) return null;
    return {
      version: 2 as const,
      classification: event.classification,
      message: POS_DIAGNOSTIC_DISPLAY_COPY[event.classification],
      routeId: event.routeId,
      online: event.online,
      occurredAt: event.occurredAt,
      ...(event.operation
        ? { operation: event.operation as PosDiagnosticOperation }
        : {}),
      ...(event.errorName
        ? { errorName: event.errorName as PosDiagnosticErrorName }
        : {}),
      ...(source ? { source } : {}),
      ...(appVersion ? { appVersion } : {}),
      ...(buildSha ? { buildSha } : {}),
      metadata: sanitizePosDiagnosticMetadata(event.metadata),
    };
  }
  if (!normalizePosDiagnosticIdentifier(event.clientEventId)) return null;
  return {
    classification: "legacy_client_event" as const,
    message: POS_DIAGNOSTIC_DISPLAY_COPY.legacy_client_event,
    occurredAt: event.occurredAt,
    metadata: {},
  };
}

function isFiniteOccurrenceTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

async function requirePosTelemetryAccess(
  ctx: MutationCtx | QueryCtx,
  organizationId: Doc<"store">["organizationId"],
): Promise<boolean> {
  try {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    if (!athenaUser) {
      return false;
    }
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to POS telemetry.",
      organizationId,
      userId: athenaUser._id,
    });
    return true;
  } catch (error) {
    if (
      isAthenaUnauthenticatedError(error) ||
      (error instanceof Error &&
        error.message === "You do not have access to POS telemetry.")
    ) {
      return false;
    }
    throw error;
  }
}

export const recordClientEvents = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    terminalFingerprint: v.optional(v.string()),
    events: v.array(clientEventInputValidator),
  },
  returns: commandResultValidator(
    v.object({
      accepted: v.number(),
      duplicates: v.number(),
    }),
  ),
  handler: admitPublicMutation(
    recordPosClientEventsOperationDefinition,
    async (ctx, args) => {
      const store = await ctx.db.get("store", args.storeId);
      if (!store) {
        return userError({
          code: "not_found",
          message: "Store not found.",
        });
      }
      if (!(await requirePosTelemetryAccess(ctx, store.organizationId))) {
        return userError({
          code: "authorization_failed",
          message: "You do not have access to report POS telemetry.",
        });
      }
      if (args.terminalId) {
        const terminal = await ctx.db.get("posTerminal", args.terminalId);
        if (!terminal || terminal.storeId !== args.storeId) {
          return userError({
            code: "authorization_failed",
            message: "Terminal does not belong to this store.",
          });
        }
      }

      const receivedAt = Date.now();
      const events = (args.events as ClientEventInput[]).slice(
        0,
        POS_CLIENT_EVENT_MAX_BATCH,
      );
      const normalizedEvents = events.map(normalizeWireEvent);
      const normalizedTerminalFingerprint = normalizePosDiagnosticIdentifier(
        args.terminalFingerprint,
      );
      const hasV2Events = events.some(
        (event) => "version" in event && event.version === 2,
      );
      if (normalizedEvents.some((event) => event === null)) {
        return userError({
          code: "validation_failed",
          message: "Client diagnostic event is invalid.",
        });
      }
      if (
        hasV2Events &&
        args.terminalFingerprint !== undefined &&
        !normalizedTerminalFingerprint
      ) {
        return userError({
          code: "validation_failed",
          message: "Client diagnostic event is invalid.",
        });
      }
      // Read-optimized dedupe: the client drains its buffer as a FIFO prefix and
      // only removes events after an acked commit, so a replayed batch always
      // starts with the same first event. One index read on the first event
      // covers the common path; only a detected replay (ack lost after commit)
      // pays per-event reads. Concurrent tab drains serialize via OCC on the
      // same index read, so the losing mutation retries into the replay path.
      const isDuplicate = async (event: ClientEventInput) =>
        (await ctx.db
          .query("posClientEvent")
          .withIndex("by_store_clientEvent", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("clientEventId", event.clientEventId),
          )
          .unique()) !== null;
      const replayedBatch =
        events.length > 0 ? await isDuplicate(events[0]) : false;
      let accepted = 0;
      let duplicates = 0;
      let checkedFirst = false;
      for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        const normalized = normalizedEvents[index]!;
        const knownDuplicate = !checkedFirst && replayedBatch;
        checkedFirst = true;
        if (knownDuplicate || (replayedBatch && (await isDuplicate(event)))) {
          duplicates += 1;
          continue;
        }
        await ctx.db.insert("posClientEvent", {
          storeId: args.storeId,
          terminalId: args.terminalId,
          terminalFingerprint: normalizedTerminalFingerprint,
          localRegisterSessionId: normalizePosDiagnosticIdentifier(
            event.localRegisterSessionId,
          ),
          clientEventId: event.clientEventId,
          level: event.level,
          flow: event.flow,
          ...normalized,
          occurredAt: normalized.occurredAt,
          receivedAt,
        });
        accepted += 1;
      }

      return ok({ accepted, duplicates });
    },
  ),
});

const clientEventReturnValidator = v.object({
  _id: v.id("posClientEvent"),
  _creationTime: v.number(),
  storeId: v.id("store"),
  terminalId: v.optional(v.id("posTerminal")),
  terminalFingerprint: v.optional(v.string()),
  localRegisterSessionId: v.optional(v.string()),
  clientEventId: v.string(),
  version: v.optional(v.literal(2)),
  level: posClientEventLevelValidator,
  flow: posClientEventFlowValidator,
  classification: posDiagnosticClassificationValidator,
  routeId: v.optional(posDiagnosticRouteIdValidator),
  online: v.optional(v.boolean()),
  operation: v.optional(v.string()),
  message: v.string(),
  errorName: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  errorStack: v.optional(v.string()),
  appVersion: v.optional(v.string()),
  buildSha: v.optional(v.string()),
  source: v.optional(posDiagnosticSourceValidator),
  metadata: v.record(v.string(), posClientEventMetadataValueValidator),
  occurredAt: v.number(),
  receivedAt: v.number(),
});

function projectClientEventForRead(row: Doc<"posClientEvent">) {
  if (row.version !== 2 || !row.classification) {
    return {
      _id: row._id,
      _creationTime: row._creationTime,
      storeId: row.storeId,
      terminalId: row.terminalId,
      terminalFingerprint: normalizePosDiagnosticIdentifier(
        row.terminalFingerprint,
      ),
      localRegisterSessionId: normalizePosDiagnosticIdentifier(
        row.localRegisterSessionId,
      ),
      clientEventId:
        normalizePosDiagnosticIdentifier(row.clientEventId) ?? String(row._id),
      level: row.level,
      flow: row.flow,
      classification: "legacy_client_event" as const,
      message: POS_DIAGNOSTIC_DISPLAY_COPY.legacy_client_event,
      // Historical rows predate the finite envelope, so even build-shaped
      // strings are not trusted for application reads.
      appVersion: undefined,
      buildSha: undefined,
      errorName: undefined,
      errorMessage: undefined,
      errorStack: undefined,
      metadata: {},
      occurredAt: isFiniteOccurrenceTime(row.occurredAt)
        ? row.occurredAt
        : row.receivedAt,
      receivedAt: isFiniteOccurrenceTime(row.receivedAt)
        ? row.receivedAt
        : row._creationTime,
    };
  }
  return {
    ...row,
    terminalFingerprint: normalizePosDiagnosticIdentifier(
      row.terminalFingerprint,
    ),
    localRegisterSessionId: normalizePosDiagnosticIdentifier(
      row.localRegisterSessionId,
    ),
    clientEventId:
      normalizePosDiagnosticIdentifier(row.clientEventId) ?? String(row._id),
    appVersion: normalizePosDiagnosticBuildIdentifier(row.appVersion),
    buildSha: normalizePosDiagnosticBuildIdentifier(row.buildSha),
    classification: row.classification,
    message: POS_DIAGNOSTIC_DISPLAY_COPY[row.classification],
    errorMessage: undefined,
    errorStack: undefined,
    metadata: sanitizePosDiagnosticMetadata(row.metadata),
    occurredAt: isFiniteOccurrenceTime(row.occurredAt)
      ? row.occurredAt
      : row.receivedAt,
    receivedAt: isFiniteOccurrenceTime(row.receivedAt)
      ? row.receivedAt
      : row._creationTime,
  };
}

export const listClientEvents = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    level: v.optional(posClientEventLevelValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(clientEventReturnValidator),
  handler: admitPublicQuery(
    listPosClientEventsReadDefinition,
    async (
      ctx,
      args: {
        level?: Doc<"posClientEvent">["level"];
        limit?: number;
        storeId: Doc<"store">["_id"];
        terminalId?: Doc<"posTerminal">["_id"];
      },
    ) => {
      const store = await ctx.db.get("store", args.storeId);
      if (!store) {
        return [];
      }
      if (!(await requirePosTelemetryAccess(ctx, store.organizationId))) {
        return [];
      }
      const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
      if (args.terminalId) {
        const terminal = await ctx.db.get("posTerminal", args.terminalId);
        if (!terminal || terminal.storeId !== args.storeId) {
          return [];
        }
        if (args.level) {
          const level = args.level;
          const rows = await ctx.db
            .query("posClientEvent")
            .withIndex(
              "by_storeId_and_terminalId_and_level_and_receivedAt",
              (q) =>
                q
                  .eq("storeId", args.storeId)
                  .eq("terminalId", args.terminalId)
                  .eq("level", level),
            )
            .order("desc")
            .take(limit);
          return rows.map(projectClientEventForRead);
        }
        const rows = await ctx.db
          .query("posClientEvent")
          .withIndex("by_store_terminal_received", (q) =>
            q.eq("storeId", args.storeId).eq("terminalId", args.terminalId),
          )
          .order("desc")
          .take(limit);
        return rows.map(projectClientEventForRead);
      }
      if (args.level) {
        const level = args.level;
        const rows = await ctx.db
          .query("posClientEvent")
          .withIndex("by_store_level_received", (q) =>
            q.eq("storeId", args.storeId).eq("level", level),
          )
          .order("desc")
          .take(limit);
        return rows.map(projectClientEventForRead);
      }
      const rows = await ctx.db
        .query("posClientEvent")
        .withIndex("by_store_received", (q) => q.eq("storeId", args.storeId))
        .order("desc")
        .take(limit);
      return rows.map(projectClientEventForRead);
    },
  ),
});

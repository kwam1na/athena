import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { commandResultValidator } from "../../lib/commandResultValidators";
import { withOperationReadAdmission } from "../../operationAdmission/publicQuery";
import { listPosClientEventsReadDefinition } from "../../operationAdmission/readDefinitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../../operationAdmission/types";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { ok, userError } from "../../../shared/commandResult";
import {
  posClientEventFlowValidator,
  posClientEventLevelValidator,
  posClientEventMetadataValueValidator,
} from "../../schemas/pos/posClientEvent";
import { redactSensitiveDiagnosticText } from "../application/diagnosticRedaction";

export const POS_CLIENT_EVENT_MAX_BATCH = 50;
export const POS_CLIENT_EVENT_MAX_MESSAGE_LENGTH = 500;
export const POS_CLIENT_EVENT_MAX_STACK_LENGTH = 4000;
export const POS_CLIENT_EVENT_MAX_METADATA_KEYS = 20;
export const POS_CLIENT_EVENT_MAX_METADATA_VALUE_LENGTH = 300;

const clientEventInputValidator = v.object({
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

type ClientEventInput = {
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

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// Client events carry free-form error text captured from arbitrary throws and
// unhandled rejections — redact secrets/PII like the runtime-status
// diagnostic path does, then truncate.
function cleanEventText(value: string, maxLength: number): string {
  return truncate(redactSensitiveDiagnosticText(value), maxLength);
}

function cleanOptionalEventText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  return value === undefined ? undefined : cleanEventText(value, maxLength);
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
        ? cleanEventText(value, POS_CLIENT_EVENT_MAX_METADATA_VALUE_LENGTH)
        : value;
  }
  return sanitized;
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
  } catch {
    return false;
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
  handler: async (ctx, args) => {
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
    for (const event of events) {
      const knownDuplicate = !checkedFirst && replayedBatch;
      checkedFirst = true;
      if (knownDuplicate || (replayedBatch && (await isDuplicate(event)))) {
        duplicates += 1;
        continue;
      }
      await ctx.db.insert("posClientEvent", {
        storeId: args.storeId,
        terminalId: args.terminalId,
        terminalFingerprint: args.terminalFingerprint
          ? truncate(args.terminalFingerprint, 200)
          : undefined,
        localRegisterSessionId: event.localRegisterSessionId
          ? truncate(event.localRegisterSessionId, 200)
          : undefined,
        clientEventId: truncate(event.clientEventId, 200),
        level: event.level,
        flow: event.flow,
        message: cleanEventText(
          event.message,
          POS_CLIENT_EVENT_MAX_MESSAGE_LENGTH,
        ),
        errorName: cleanOptionalEventText(event.errorName, 200),
        errorMessage: cleanOptionalEventText(
          event.errorMessage,
          POS_CLIENT_EVENT_MAX_MESSAGE_LENGTH,
        ),
        errorStack: cleanOptionalEventText(
          event.errorStack,
          POS_CLIENT_EVENT_MAX_STACK_LENGTH,
        ),
        appVersion: event.appVersion
          ? truncate(event.appVersion, 100)
          : undefined,
        metadata: sanitizeClientEventMetadata(event.metadata),
        occurredAt: event.occurredAt,
        receivedAt,
      });
      accepted += 1;
    }

    return ok({ accepted, duplicates });
  },
});

const clientEventReturnValidator = v.object({
  _id: v.id("posClientEvent"),
  _creationTime: v.number(),
  storeId: v.id("store"),
  terminalId: v.optional(v.id("posTerminal")),
  terminalFingerprint: v.optional(v.string()),
  localRegisterSessionId: v.optional(v.string()),
  clientEventId: v.string(),
  level: posClientEventLevelValidator,
  flow: posClientEventFlowValidator,
  message: v.string(),
  errorName: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  errorStack: v.optional(v.string()),
  appVersion: v.optional(v.string()),
  metadata: v.record(v.string(), posClientEventMetadataValueValidator),
  occurredAt: v.number(),
  receivedAt: v.number(),
});

export const listClientEvents = query({
  args: {
    storeId: v.id("store"),
    level: v.optional(posClientEventLevelValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(clientEventReturnValidator),
  handler: withOperationReadAdmission(
    listPosClientEventsReadDefinition,
    async (
      ctx,
      args: {
        level?: Doc<"posClientEvent">["level"];
        limit?: number;
        storeId: Doc<"store">["_id"];
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
      if (args.level) {
        const level = args.level;
        return await ctx.db
          .query("posClientEvent")
          .withIndex("by_store_level_received", (q) =>
            q.eq("storeId", args.storeId).eq("level", level),
          )
          .order("desc")
          .take(limit);
      }
      return await ctx.db
        .query("posClientEvent")
        .withIndex("by_store_received", (q) => q.eq("storeId", args.storeId))
        .order("desc")
        .take(limit);
    },
  ),
});

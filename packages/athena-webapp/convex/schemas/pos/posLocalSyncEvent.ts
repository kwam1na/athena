import { v } from "convex/values";

import {
  POS_LOCAL_SYNC_EVENT_STATUSES,
  POS_LOCAL_SYNC_EVENT_TYPES,
} from "../../../shared/posLocalSyncContract";

const POS_LOCAL_SYNC_EVENT_TYPE_COUNT: (typeof POS_LOCAL_SYNC_EVENT_TYPES)["length"] = 8;
const POS_LOCAL_SYNC_EVENT_STATUS_COUNT: (typeof POS_LOCAL_SYNC_EVENT_STATUSES)["length"] = 5;
void POS_LOCAL_SYNC_EVENT_TYPE_COUNT;
void POS_LOCAL_SYNC_EVENT_STATUS_COUNT;

export const posLocalSyncEventStatusValidator = v.union(
  v.literal(POS_LOCAL_SYNC_EVENT_STATUSES[0]),
  v.literal(POS_LOCAL_SYNC_EVENT_STATUSES[1]),
  v.literal(POS_LOCAL_SYNC_EVENT_STATUSES[2]),
  v.literal(POS_LOCAL_SYNC_EVENT_STATUSES[3]),
  v.literal(POS_LOCAL_SYNC_EVENT_STATUSES[4]),
);

export const posLocalSyncEventTypeValidator = v.union(
  v.literal(POS_LOCAL_SYNC_EVENT_TYPES[0]),
  v.literal(POS_LOCAL_SYNC_EVENT_TYPES[1]),
  v.literal(POS_LOCAL_SYNC_EVENT_TYPES[2]),
  v.literal(POS_LOCAL_SYNC_EVENT_TYPES[3]),
  v.literal(POS_LOCAL_SYNC_EVENT_TYPES[4]),
  v.literal(POS_LOCAL_SYNC_EVENT_TYPES[5]),
  v.literal(POS_LOCAL_SYNC_EVENT_TYPES[6]),
  v.literal(POS_LOCAL_SYNC_EVENT_TYPES[7]),
);

export const posLocalSyncEventSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  syncScope: v.optional(v.union(v.literal("pos"), v.literal("expense"))),
  localEventId: v.string(),
  localRegisterSessionId: v.string(),
  localExpenseSessionId: v.optional(v.string()),
  sequence: v.number(),
  eventType: posLocalSyncEventTypeValidator,
  occurredAt: v.number(),
  staffProfileId: v.id("staffProfile"),
  staffProofTokenHash: v.optional(v.string()),
  payload: v.record(v.string(), v.any()),
  status: posLocalSyncEventStatusValidator,
  submittedAt: v.number(),
  acceptedAt: v.optional(v.number()),
  projectedAt: v.optional(v.number()),
  heldReason: v.optional(v.string()),
  rejectionCode: v.optional(v.string()),
  rejectionMessage: v.optional(v.string()),
  // U9: server-derived clock attribution, computed once at first ingest and
  // stored additively. These fields are NOT part of the `isSameLocalEvent`
  // retry-match (which compares only occurredAt + payload), so recording them
  // cannot break sync-event idempotency. `occurredAt` and `payload` keep the
  // terminal-supplied values; the server-authoritative business time and
  // operating date live here so terminal clock skew cannot silently corrupt
  // operating-day attribution.
  serverOccurredAt: v.optional(v.number()),
  serverOperatingDate: v.optional(v.string()),
  clockObservation: v.optional(
    v.object({
      serverTimeAt: v.number(),
      occurredAtStatus: v.union(
        v.literal("in_bounds"),
        v.literal("future_skew_clamped"),
      ),
      operatingDateStatus: v.optional(
        v.union(
          v.literal("terminal_matched"),
          v.literal("server_corrected"),
          v.literal("missing_timezone_authority"),
        ),
      ),
      terminalOperatingDate: v.optional(v.string()),
    }),
  ),
});

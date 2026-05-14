import { v } from "convex/values";

import {
  POS_LOCAL_SYNC_EVENT_STATUSES,
  POS_LOCAL_SYNC_EVENT_TYPES,
} from "../../../shared/posLocalSyncContract";

const POS_LOCAL_SYNC_EVENT_TYPE_COUNT: (typeof POS_LOCAL_SYNC_EVENT_TYPES)["length"] = 5;
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
);

export const posLocalSyncEventSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  localEventId: v.string(),
  localRegisterSessionId: v.string(),
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
});

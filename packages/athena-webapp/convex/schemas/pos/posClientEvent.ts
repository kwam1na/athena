import { v } from "convex/values";

export const POS_CLIENT_EVENT_LEVELS = ["warn", "error"] as const;

export const POS_CLIENT_EVENT_FLOWS = [
  "checkout",
  "session",
  "register",
  "sync",
  "storage",
  "catalog",
  "expense",
  "settings",
  "runtime",
  "unhandled",
  "other",
] as const;

export type PosClientEventLevel = (typeof POS_CLIENT_EVENT_LEVELS)[number];
export type PosClientEventFlow = (typeof POS_CLIENT_EVENT_FLOWS)[number];

export const posClientEventLevelValidator = v.union(
  v.literal(POS_CLIENT_EVENT_LEVELS[0]),
  v.literal(POS_CLIENT_EVENT_LEVELS[1]),
);

export const posClientEventFlowValidator = v.union(
  v.literal(POS_CLIENT_EVENT_FLOWS[0]),
  v.literal(POS_CLIENT_EVENT_FLOWS[1]),
  v.literal(POS_CLIENT_EVENT_FLOWS[2]),
  v.literal(POS_CLIENT_EVENT_FLOWS[3]),
  v.literal(POS_CLIENT_EVENT_FLOWS[4]),
  v.literal(POS_CLIENT_EVENT_FLOWS[5]),
  v.literal(POS_CLIENT_EVENT_FLOWS[6]),
  v.literal(POS_CLIENT_EVENT_FLOWS[7]),
  v.literal(POS_CLIENT_EVENT_FLOWS[8]),
  v.literal(POS_CLIENT_EVENT_FLOWS[9]),
  v.literal(POS_CLIENT_EVENT_FLOWS[10]),
);

export const posClientEventMetadataValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
);

export const posClientEventSchema = v.object({
  storeId: v.id("store"),
  // Optional because errors can occur before a terminal is provisioned; the
  // fingerprint still ties events from the same device together.
  terminalId: v.optional(v.id("posTerminal")),
  terminalFingerprint: v.optional(v.string()),
  localRegisterSessionId: v.optional(v.string()),
  // Client-minted idempotency key so retried drains never duplicate rows.
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

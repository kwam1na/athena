import { v } from "convex/values";
import {
  POS_CLIENT_EVENT_FLOWS,
  POS_CLIENT_EVENT_LEVELS,
  POS_DIAGNOSTIC_CLASSIFICATIONS,
  POS_DIAGNOSTIC_ROUTE_IDS,
} from "../../../shared/posDiagnosticRedaction";

export {
  POS_CLIENT_EVENT_FLOWS,
  POS_CLIENT_EVENT_LEVELS,
  POS_DIAGNOSTIC_CLASSIFICATIONS,
  POS_DIAGNOSTIC_ROUTE_IDS,
};

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
  v.literal(POS_CLIENT_EVENT_FLOWS[11]),
  v.literal(POS_CLIENT_EVENT_FLOWS[12]),
);

export const posDiagnosticClassificationValidator = v.union(
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[0]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[1]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[2]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[3]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[4]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[5]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[6]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[7]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[8]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[9]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[10]),
  v.literal(POS_DIAGNOSTIC_CLASSIFICATIONS[11]),
);

export const posDiagnosticRouteIdValidator = v.union(
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[0]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[1]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[2]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[3]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[4]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[5]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[6]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[7]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[8]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[9]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[10]),
  v.literal(POS_DIAGNOSTIC_ROUTE_IDS[11]),
);

export const posDiagnosticSourceValidator = v.object({
  asset: v.string(),
  line: v.optional(v.number()),
  column: v.optional(v.number()),
});

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
  version: v.optional(v.literal(2)),
  level: posClientEventLevelValidator,
  flow: posClientEventFlowValidator,
  classification: v.optional(posDiagnosticClassificationValidator),
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

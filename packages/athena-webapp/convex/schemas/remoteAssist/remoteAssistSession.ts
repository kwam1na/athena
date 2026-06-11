import { v } from "convex/values";

export const remoteAssistModeValidator = v.union(
  v.literal("attended"),
  v.literal("unattended"),
);

export const remoteAssistSessionStatusValidator = v.union(
  v.literal("pending_attended_approval"),
  v.literal("connecting"),
  v.literal("active"),
  v.literal("ended"),
  v.literal("expired"),
  v.literal("denied"),
);

export const remoteAssistTransportProviderValidator = v.union(
  v.literal("livekit"),
  v.literal("provider_adapter"),
  v.literal("none"),
);

export const remoteAssistParticipantRoleValidator = v.union(
  v.literal("support"),
  v.literal("runtime"),
);

export const remoteAssistEventTypeValidator = v.union(
  v.literal("policy_allowed"),
  v.literal("policy_denied"),
  v.literal("session_requested"),
  v.literal("session_started"),
  v.literal("session_ended"),
  v.literal("session_expired"),
  v.literal("runtime_claimed"),
  v.literal("runtime_disconnected"),
  v.literal("support_joined"),
  v.literal("runtime_joined"),
  v.literal("transport_token_issued"),
  v.literal("sensitive_mode_started"),
  v.literal("sensitive_mode_ended"),
  v.literal("control_rejected"),
  v.literal("pos_recovery_requested"),
  v.literal("pos_recovery_completed"),
  v.literal("pos_recovery_failed"),
);

export const remoteAssistSessionSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.optional(v.id("store")),
  clientId: v.id("remoteAssistClient"),
  requestedByUserId: v.id("athenaUser"),
  requestedMode: remoteAssistModeValidator,
  effectiveMode: remoteAssistModeValidator,
  reason: v.string(),
  status: remoteAssistSessionStatusValidator,
  transportProvider: remoteAssistTransportProviderValidator,
  transportRoomId: v.optional(v.string()),
  sensitiveModeActive: v.boolean(),
  requestedAt: v.number(),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  expiresAt: v.number(),
  terminationReason: v.optional(v.string()),
});

export const remoteAssistSessionEventSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.optional(v.id("store")),
  clientId: v.id("remoteAssistClient"),
  sessionId: v.optional(v.id("remoteAssistSession")),
  actorUserId: v.optional(v.id("athenaUser")),
  participantRole: v.optional(remoteAssistParticipantRoleValidator),
  eventType: remoteAssistEventTypeValidator,
  occurredAt: v.number(),
  summary: v.string(),
  metadata: v.optional(v.record(v.string(), v.any())),
});

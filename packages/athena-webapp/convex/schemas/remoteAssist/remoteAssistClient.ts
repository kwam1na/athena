import { v } from "convex/values";

export const remoteAssistRuntimeTypeValidator = v.union(
  v.literal("pos_terminal"),
  v.literal("inventory_station"),
  v.literal("operations_display"),
  v.literal("admin_workstation"),
);

export const remoteAssistEnrollmentStatusValidator = v.union(
  v.literal("active"),
  v.literal("disabled"),
  v.literal("revoked"),
);

export const remoteAssistAccessPolicyValidator = v.union(
  v.literal("unattended_allowed"),
  v.literal("attended_required"),
  v.literal("disabled"),
);

export const remoteAssistPresenceStatusValidator = v.union(
  v.literal("online"),
  v.literal("stale"),
  v.literal("offline"),
  v.literal("unknown"),
);

export const remoteAssistCapabilitiesValidator = v.object({
  attendedScreenShare: v.boolean(),
  boundedControl: v.boolean(),
  sensitiveMasking: v.boolean(),
  unattendedCoBrowsing: v.boolean(),
});

export const remoteAssistClientSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.optional(v.id("store")),
  runtimeType: remoteAssistRuntimeTypeValidator,
  runtimeIdentity: v.string(),
  displayName: v.string(),
  enrollmentStatus: remoteAssistEnrollmentStatusValidator,
  accessPolicy: remoteAssistAccessPolicyValidator,
  capabilities: remoteAssistCapabilitiesValidator,
  adapterRef: v.optional(
    v.object({
      kind: v.string(),
      id: v.string(),
      label: v.optional(v.string()),
    }),
  ),
  presenceStatus: remoteAssistPresenceStatusValidator,
  lastPresenceAt: v.optional(v.number()),
  browserSummary: v.optional(v.record(v.string(), v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
});

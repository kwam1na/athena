import {
  ok,
  userError,
  type CommandResult,
} from "../../../shared/commandResult";

export const REMOTE_ASSIST_SESSION_TTL_MS = 20 * 60 * 1000;
export const REMOTE_ASSIST_PRESENCE_FRESHNESS_MS = 2 * 60 * 1000;

export const REMOTE_ASSIST_RUNTIME_TYPES = [
  "pos_terminal",
  "inventory_station",
  "operations_display",
  "admin_workstation",
] as const;

export type RemoteAssistRuntimeType =
  (typeof REMOTE_ASSIST_RUNTIME_TYPES)[number];

export type RemoteAssistMode = "attended" | "unattended";
export type RemoteAssistAccessPolicy =
  | "unattended_allowed"
  | "attended_required"
  | "disabled";
export type RemoteAssistEnrollmentStatus = "active" | "disabled" | "revoked";
export type RemoteAssistPresenceStatus =
  | "online"
  | "stale"
  | "offline"
  | "unknown";
export type RemoteAssistSessionStatus =
  | "pending_attended_approval"
  | "connecting"
  | "active"
  | "ended"
  | "expired"
  | "denied";
export type RemoteAssistTransportProvider =
  | "livekit"
  | "provider_adapter"
  | "none";
export type RemoteAssistEventType =
  | "policy_allowed"
  | "policy_denied"
  | "session_requested"
  | "session_started"
  | "session_ended"
  | "session_expired"
  | "runtime_claimed"
  | "runtime_disconnected"
  | "support_joined"
  | "runtime_joined"
  | "transport_token_issued"
  | "sensitive_mode_started"
  | "sensitive_mode_ended"
  | "control_rejected"
  | "pos_recovery_requested"
  | "pos_recovery_completed"
  | "pos_recovery_failed";

export type RemoteAssistCapabilities = {
  attendedScreenShare: boolean;
  boundedControl: boolean;
  sensitiveMasking: boolean;
  unattendedCoBrowsing: boolean;
};

export type RemoteAssistClient = {
  _id: string;
  organizationId: string;
  storeId?: string;
  runtimeType: RemoteAssistRuntimeType;
  runtimeIdentity: string;
  displayName: string;
  enrollmentStatus: RemoteAssistEnrollmentStatus;
  accessPolicy: RemoteAssistAccessPolicy;
  capabilities: RemoteAssistCapabilities;
  adapterRef?: {
    kind: string;
    id: string;
    label?: string;
  };
  presenceStatus: RemoteAssistPresenceStatus;
  lastPresenceAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type RemoteAssistSession = {
  _id: string;
  _creationTime: number;
  organizationId: string;
  storeId?: string;
  clientId: string;
  requestedByUserId: string;
  requestedMode: RemoteAssistMode;
  effectiveMode: RemoteAssistMode;
  reason: string;
  status: RemoteAssistSessionStatus;
  transportProvider: RemoteAssistTransportProvider;
  transportRoomId?: string;
  sensitiveModeActive: boolean;
  requestedAt: number;
  startedAt?: number;
  endedAt?: number;
  expiresAt: number;
  terminationReason?: string;
};

export type RemoteAssistSessionEvent = {
  organizationId: string;
  storeId?: string;
  clientId: string;
  sessionId?: string;
  actorUserId?: string;
  participantRole?: "support" | "runtime";
  eventType: RemoteAssistEventType;
  occurredAt: number;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type RemoteAssistTransportParticipantRole = "support" | "runtime";

export type RemoteAssistTransportCredential = {
  expiresAt: number;
  participantIdentity: string;
  participantRole: RemoteAssistTransportParticipantRole;
  provider: RemoteAssistTransportProvider;
  roomId: string;
  sessionId: string;
  token: string;
  topics: {
    controlIntents: string;
    controlResults: string;
    runtimeFrames: string;
    runtimeState: string;
  };
  url: string;
};

export type RemoteAssistTransportCredentialContext = Omit<
  RemoteAssistTransportCredential,
  "token" | "url"
> & {
  clientId: string;
  organizationId: string;
  storeId?: string;
};

const SECRET_LIKE_KEYS = [
  "authorization",
  "customer",
  "password",
  "payload",
  "payment",
  "pin",
  "secret",
  "staffproof",
  "sync",
  "token",
  "verifier",
] as const;
const SECRET_LIKE_FIELD_PATTERN = new RegExp(
  SECRET_LIKE_KEYS.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i",
);

export function sanitizeRemoteAssistMetadata(
  metadata: Record<string, unknown> | undefined,
): CommandResult<Record<string, unknown> | undefined> {
  if (!metadata) {
    return ok(undefined);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_LIKE_FIELD_PATTERN.test(key)) {
      return userError({
        code: "validation_failed",
        message: "Remote Assist audit metadata can only store non-secret support context.",
      });
    }
    sanitized[key] = sanitizeRemoteAssistValue(value);
  }
  return ok(sanitized);
}

export function summarizeRemoteAssistReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, 240);
}

function sanitizeRemoteAssistValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim().slice(0, 240);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeRemoteAssistValue);
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (SECRET_LIKE_FIELD_PATTERN.test(key)) {
        sanitized[key] = "[redacted]";
      } else {
        sanitized[key] = sanitizeRemoteAssistValue(nestedValue);
      }
    }
    return sanitized;
  }
  return undefined;
}

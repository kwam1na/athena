import type {
  RemoteAssistTransportCredential,
  RemoteAssistTransportCredentialContext,
  RemoteAssistTransportParticipantRole,
} from "../../application/types";

export const REMOTE_ASSIST_TRANSPORT_TOKEN_TTL_MS = 5 * 60 * 1000;

export const REMOTE_ASSIST_TRANSPORT_TOPICS = {
  controlIntents: "remote-assist.control-intents",
  controlResults: "remote-assist.control-results",
  runtimeFrames: "remote-assist.runtime-frames",
  runtimeState: "remote-assist.runtime-state",
} as const;

export type RemoteAssistTransportTokenRequest = {
  context: RemoteAssistTransportCredentialContext;
  ttlSeconds: number;
};

export type RemoteAssistTransportProvider = {
  issueCredential(
    request: RemoteAssistTransportTokenRequest,
  ): Promise<RemoteAssistTransportCredential>;
};

export function buildRemoteAssistTransportCredentialContext(args: {
  clientId: string;
  expiresAt: number;
  organizationId: string;
  participantRole: RemoteAssistTransportParticipantRole;
  requestedByUserId?: string;
  roomId: string;
  sessionId: string;
  storeId?: string;
}): RemoteAssistTransportCredentialContext {
  const participantIdentity = [
    "remote-assist",
    args.sessionId,
    args.participantRole,
    args.participantRole === "support"
      ? args.requestedByUserId ?? "support"
      : args.clientId,
  ]
    .join(":")
    .replace(/[^A-Za-z0-9:_-]/g, "_");

  return {
    clientId: args.clientId,
    expiresAt: args.expiresAt,
    organizationId: args.organizationId,
    participantIdentity,
    participantRole: args.participantRole,
    provider: "livekit",
    roomId: args.roomId,
    sessionId: args.sessionId,
    storeId: args.storeId,
    topics: { ...REMOTE_ASSIST_TRANSPORT_TOPICS },
  };
}

export function buildRemoteAssistTransportRoomId(sessionId: string): string {
  return `athena-remote-assist-${sessionId}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

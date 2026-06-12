import { describe, expect, it } from "vitest";

import {
  buildRemoteAssistTransportCredentialContext,
  buildRemoteAssistTransportRoomId,
  REMOTE_ASSIST_TRANSPORT_TOPICS,
  REMOTE_ASSIST_TRANSPORT_TOKEN_TTL_MS,
} from "./RemoteAssistTransportProvider";

describe("Remote Assist transport provider contract", () => {
  it("builds role-scoped support credential context without provider secrets", () => {
    const context = buildRemoteAssistTransportCredentialContext({
      clientId: "client-1",
      expiresAt: 2_000_000 + REMOTE_ASSIST_TRANSPORT_TOKEN_TTL_MS,
      organizationId: "org-1",
      participantRole: "support",
      requestedByUserId: "user-1",
      roomId: "room-1",
      sessionId: "session-1",
      storeId: "store-1",
    });

    expect(context).toEqual({
      clientId: "client-1",
      expiresAt: 2_000_000 + REMOTE_ASSIST_TRANSPORT_TOKEN_TTL_MS,
      organizationId: "org-1",
      participantIdentity: "remote-assist:session-1:support:user-1",
      participantRole: "support",
      provider: "livekit",
      roomId: "room-1",
      sessionId: "session-1",
      storeId: "store-1",
      topics: REMOTE_ASSIST_TRANSPORT_TOPICS,
    });
    expect(JSON.stringify(context)).not.toMatch(/apiSecret|LIVEKIT_API_SECRET|token/i);
  });

  it("uses runtime client identity for runtime participants", () => {
    const context = buildRemoteAssistTransportCredentialContext({
      clientId: "client-1",
      expiresAt: 2_000_000,
      organizationId: "org-1",
      participantRole: "runtime",
      roomId: "room-1",
      sessionId: "session-1",
    });

    expect(context.participantIdentity).toBe(
      "remote-assist:session-1:runtime:client-1",
    );
  });

  it("normalizes provider room ids from Convex session ids", () => {
    expect(buildRemoteAssistTransportRoomId("session:abc/123")).toBe(
      "athena-remote-assist-session-abc-123",
    );
  });
});

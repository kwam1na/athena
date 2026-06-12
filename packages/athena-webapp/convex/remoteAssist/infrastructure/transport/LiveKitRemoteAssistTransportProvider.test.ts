import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accessToken: {
    addGrant: vi.fn(),
    toJwt: vi.fn(async () => "jwt-token"),
  },
  createRoom: vi.fn(async () => ({})),
  AccessToken: vi.fn(),
  RoomServiceClient: vi.fn(),
}));

vi.mock("livekit-server-sdk", () => ({
  AccessToken: mocks.AccessToken,
  RoomServiceClient: mocks.RoomServiceClient,
}));

import {
  getLiveKitConfig,
  LiveKitRemoteAssistTransportProvider,
} from "./LiveKitRemoteAssistTransportProvider";

describe("LiveKit Remote Assist transport provider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.AccessToken.mockReturnValue(mocks.accessToken);
    mocks.RoomServiceClient.mockReturnValue({
      createRoom: mocks.createRoom,
    });
  });

  it("creates a bounded room and mints a scoped support token", async () => {
    const provider = new LiveKitRemoteAssistTransportProvider({
      apiKey: "key",
      apiSecret: "secret",
      url: "https://livekit.example.com",
    });

    const credential = await provider.issueCredential({
      context: buildContext(),
      ttlSeconds: 300,
    });

    expect(mocks.RoomServiceClient).toHaveBeenCalledWith(
      "https://livekit.example.com",
      "key",
      "secret",
    );
    expect(mocks.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        maxParticipants: 3,
        name: "room-1",
      }),
    );
    expect(mocks.AccessToken).toHaveBeenCalledWith("key", "secret", {
      identity: "remote-assist:session-1:support:user-1",
      metadata: JSON.stringify({
        participantRole: "support",
        sessionId: "session-1",
      }),
      ttl: 300,
    });
    expect(mocks.accessToken.addGrant).toHaveBeenCalledWith({
      canPublish: false,
      canPublishData: true,
      canSubscribe: true,
      room: "room-1",
      roomJoin: true,
    });
    expect(credential).toMatchObject({
      provider: "livekit",
      roomId: "room-1",
      token: "jwt-token",
      url: "https://livekit.example.com",
    });
  });

  it("treats an already-existing room as a successful credential issuance", async () => {
    mocks.createRoom.mockRejectedValueOnce(new Error("already exists"));
    const provider = new LiveKitRemoteAssistTransportProvider({
      apiKey: "key",
      apiSecret: "secret",
      url: "https://livekit.example.com",
    });

    await expect(
      provider.issueCredential({
        context: buildContext(),
        ttlSeconds: 300,
      }),
    ).resolves.toMatchObject({
      provider: "livekit",
      token: "jwt-token",
    });
  });

  it("propagates non-idempotent room creation failures", async () => {
    mocks.createRoom.mockRejectedValueOnce(new Error("network down"));
    const provider = new LiveKitRemoteAssistTransportProvider({
      apiKey: "key",
      apiSecret: "secret",
      url: "https://livekit.example.com",
    });

    await expect(
      provider.issueCredential({
        context: buildContext(),
        ttlSeconds: 300,
      }),
    ).rejects.toThrow("network down");
  });

  it("requires LiveKit API key, secret, and URL environment configuration", () => {
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      LIVEKIT_API_KEY: "",
      LIVEKIT_API_SECRET: "",
      LIVEKIT_URL: "",
      LIVEKIT_HOST: "",
    };

    expect(() => getLiveKitConfig()).toThrow(
      "Remote Assist transport provider is not configured.",
    );

    process.env = originalEnv;
  });
});

function buildContext() {
  return {
    clientId: "client-1",
    expiresAt: 2_000_000,
    organizationId: "org-1",
    participantIdentity: "remote-assist:session-1:support:user-1",
    participantRole: "support" as const,
    provider: "livekit" as const,
    roomId: "room-1",
    sessionId: "session-1",
    topics: {
      controlIntents: "remote-assist.control-intents",
      controlResults: "remote-assist.control-results",
      runtimeFrames: "remote-assist.runtime-frames",
      runtimeState: "remote-assist.runtime-state",
    },
  };
}

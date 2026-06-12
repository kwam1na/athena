import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseRemoteAssistTransportMessage } from "./RemoteAssistLiveTransportClient";
import { createLiveKitRemoteAssistClient } from "./livekitRemoteAssistClient";

type LiveKitMockHandler = (...args: unknown[]) => void;

const liveKitMocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  handlers: new Map<string, LiveKitMockHandler>(),
  off: vi.fn((event: string) => {
    liveKitMocks.handlers.delete(event);
  }),
  on: vi.fn((event: string, handler: LiveKitMockHandler) => {
    liveKitMocks.handlers.set(event, handler);
  }),
  publishData: vi.fn(async () => undefined),
}));

vi.mock("livekit-client", () => ({
  DataPacket_Kind: { RELIABLE: 0 },
  Room: vi.fn(() => ({
    connect: liveKitMocks.connect,
    disconnect: liveKitMocks.disconnect,
    localParticipant: {
      publishData: liveKitMocks.publishData,
    },
    off: liveKitMocks.off,
    on: liveKitMocks.on,
  })),
  RoomEvent: {
    DataReceived: "DataReceived",
    Disconnected: "Disconnected",
    Reconnected: "Reconnected",
    Reconnecting: "Reconnecting",
  },
}));

const credential = {
  expiresAt: 2_000,
  participantIdentity: "remote-assist:session-1:runtime:client-1",
  participantRole: "runtime" as const,
  provider: "livekit" as const,
  roomId: "room-1",
  sessionId: "session-1",
  token: "token-1",
  topics: {
    controlIntents: "remote-assist.control-intents",
    controlResults: "remote-assist.control-results",
    runtimeFrames: "remote-assist.runtime-frames",
    runtimeState: "remote-assist.runtime-state",
  },
  url: "wss://livekit.example.com",
};

describe("RemoteAssistLiveTransportClient", () => {
  beforeEach(() => {
    liveKitMocks.connect.mockClear();
    liveKitMocks.disconnect.mockClear();
    liveKitMocks.handlers.clear();
    liveKitMocks.off.mockClear();
    liveKitMocks.on.mockClear();
    liveKitMocks.publishData.mockClear();
  });

  it("parses known Remote Assist transport topics only", () => {
    expect(
      parseRemoteAssistTransportMessage({
        payload: { sessionId: "session-1" },
        topic: "runtimeFrames",
      }),
    ).toEqual({
      payload: { sessionId: "session-1" },
      topic: "runtimeFrames",
    });

    expect(
      parseRemoteAssistTransportMessage({
        payload: {},
        topic: "livekit-internal",
      }),
    ).toBeNull();
  });

  it("connects, emits state, and publishes messages on mapped transport topics", async () => {
    const client = createLiveKitRemoteAssistClient();
    const states: string[] = [];
    client.subscribeToConnectionState((state) => states.push(state));

    await client.connect(credential);
    await client.publish({
      payload: {
        accepted: true,
        event: {
          action: "up",
          pointerId: "support-pointer",
          type: "pointer",
          x: 10,
          y: 10,
        },
        idempotencyKey: "intent-1",
        sessionId: "session-1",
      },
      topic: "controlResults",
    });

    expect(liveKitMocks.connect).toHaveBeenCalledWith(
      "wss://livekit.example.com",
      "token-1",
      { autoSubscribe: true },
    );
    expect(states).toEqual(["idle", "connecting", "connected"]);
    const publishCall = liveKitMocks.publishData.mock.calls[0] as unknown as [
      Uint8Array,
      Record<string, unknown>,
    ];
    expect(ArrayBuffer.isView(publishCall[0])).toBe(true);
    expect(publishCall[1]).toEqual({
      destinationIdentities: [],
      reliable: true,
      topic: "remote-assist.control-results",
    });
    expect(
      JSON.parse(new TextDecoder().decode(publishCall[0])),
    ).toMatchObject({
      payload: {
        accepted: true,
        idempotencyKey: "intent-1",
      },
      topic: "controlResults",
    });
  });

  it("dispatches only role-bound messages whose payload topic matches the LiveKit topic", async () => {
    const client = createLiveKitRemoteAssistClient();
    const messages: unknown[] = [];
    client.subscribe((message) => messages.push(message));

    await client.connect(credential);
    const receive = liveKitMocks.handlers.get("DataReceived");
    expect(receive).toBeTruthy();

    receive!(
      encode({
        payload: { idempotencyKey: "accepted-control", sessionId: "session-1" },
        topic: "controlIntents",
      }),
      {
        identity: "remote-assist:session-1:support:user-1",
        metadata: JSON.stringify({
          participantRole: "support",
          sessionId: "session-1",
        }),
      },
      undefined,
      "remote-assist.control-intents",
    );
    receive!(
      encode({
        payload: { idempotencyKey: "runtime-forged", sessionId: "session-1" },
        topic: "controlIntents",
      }),
      {
        identity: "remote-assist:session-1:runtime:client-2",
        metadata: JSON.stringify({
          participantRole: "runtime",
          sessionId: "session-1",
        }),
      },
      undefined,
      "remote-assist.control-intents",
    );
    receive!(
      encode({
        payload: { idempotencyKey: "topic-mismatch", sessionId: "session-1" },
        topic: "controlIntents",
      }),
      {
        identity: "remote-assist:session-1:support:user-1",
        metadata: JSON.stringify({
          participantRole: "support",
          sessionId: "session-1",
        }),
      },
      undefined,
      "remote-assist.runtime-frames",
    );

    expect(messages).toEqual([
      {
        payload: {
          idempotencyKey: "accepted-control",
          sessionId: "session-1",
        },
        topic: "controlIntents",
      },
    ]);
  });
});

function encode(payload: unknown) {
  return new TextEncoder().encode(JSON.stringify(payload));
}

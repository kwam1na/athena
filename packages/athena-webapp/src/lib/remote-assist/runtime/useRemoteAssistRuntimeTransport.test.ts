import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRemoteAssistRuntimeTransport } from "./useRemoteAssistRuntimeTransport";
import type {
  RemoteAssistLiveTransportClient,
  RemoteAssistTransportConnectionState,
  RemoteAssistTransportCredential,
  RemoteAssistTransportMessage,
} from "../transport/RemoteAssistLiveTransportClient";

const requestCredentialMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useAction: () => requestCredentialMock,
}));

const credential: RemoteAssistTransportCredential = {
  clientId: "client-1",
  expiresAt: 2_000,
  participantIdentity: "remote-assist:session-1:runtime:terminal-1",
  participantRole: "runtime",
  provider: "livekit",
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

describe("useRemoteAssistRuntimeTransport", () => {
  beforeEach(() => {
    vi.useRealTimers();
    requestCredentialMock.mockReset();
    requestCredentialMock.mockResolvedValue({
      data: credential,
      kind: "ok",
    });
    document.body.innerHTML = "<main><button>Checkout</button></main>";
  });

  it("skips credential request until runtime proof and session inputs are present", () => {
    const client = createFakeClient();
    const clientFactory = vi.fn(() => client);

    renderHook(() =>
      useRemoteAssistRuntimeTransport({
        clientFactory,
        enabled: true,
        session: activeSession(),
        storeId: "store-1",
        syncSecretHash: undefined,
        terminalId: "terminal-1",
      }),
    );

    expect(requestCredentialMock).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("requests credentials, publishes initial state, and does not reconnect on state changes", async () => {
    window.history.replaceState(null, "", "/pos/register?token=secret-token");
    const client = createFakeClient({
      onConnect: () => {
        client.emitState("connecting");
        client.emitState("connected");
      },
    });
    const clientFactory = vi.fn(() => client);
    const session = activeSession();

    renderHook(() =>
      useRemoteAssistRuntimeTransport({
        clientFactory,
        enabled: true,
        session,
        storeId: "store-1",
        syncSecretHash: "sync-hash",
        terminalId: "terminal-1",
      }),
    );

    await waitFor(() => expect(client.connect).toHaveBeenCalledWith(credential));

    expect(requestCredentialMock).toHaveBeenCalledTimes(1);
    expect(requestCredentialMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      storeId: "store-1",
      syncSecretHash: "sync-hash",
      terminalId: "terminal-1",
    });
    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "runtimeFrames" }),
    );
    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "runtimeState" }),
    );
    const runtimeStateMessage = client.publish.mock.calls
      .map((call) => call[0])
      .find((message) => message.topic === "runtimeState");
    expect(runtimeStateMessage?.payload).toMatchObject({
      route: "/pos/register",
    });
    expect(JSON.stringify(runtimeStateMessage)).not.toContain("secret-token");
  });

  it("publishes frames and state on timers, then disconnects on cleanup", async () => {
    vi.useFakeTimers();
    const client = createFakeClient();
    const clientFactory = vi.fn(() => client);

    const { unmount } = renderHook(() =>
      useRemoteAssistRuntimeTransport({
        clientFactory,
        enabled: true,
        session: activeSession(),
        storeId: "store-1",
        syncSecretHash: "sync-hash",
        terminalId: "terminal-1",
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(client.connect).toHaveBeenCalled();
    client.publish.mockClear();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "runtimeFrames" }),
    );
    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "runtimeState" }),
    );

    unmount();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it("applies control intents only for active unattended sessions outside sensitive mode", async () => {
    const onClick = vi.fn();
    document.body.innerHTML = `<button aria-label="Checkout" data-remote-assist-control="checkout">Checkout</button>`;
    const button = document.querySelector("button")!;
    button.getBoundingClientRect = () =>
      ({
        bottom: 40,
        height: 30,
        left: 10,
        right: 110,
        toJSON: () => ({}),
        top: 10,
        width: 100,
        x: 10,
        y: 10,
      }) as DOMRect;
    button.addEventListener("click", onClick);
    document.elementFromPoint = vi.fn(() => button) as typeof document.elementFromPoint;
    const client = createFakeClient();
    const clientFactory = vi.fn(() => client);

    renderHook(() =>
      useRemoteAssistRuntimeTransport({
        clientFactory,
        enabled: true,
        session: activeSession(),
        storeId: "store-1",
        syncSecretHash: "sync-hash",
        terminalId: "terminal-1",
      }),
    );
    await waitFor(() => expect(client.connect).toHaveBeenCalled());

    act(() => {
      client.emitMessage({
        payload: {
          event: {
            action: "up",
            pointerId: "support-pointer",
            type: "pointer",
            x: 20,
            y: 20,
          },
          idempotencyKey: "intent-1",
          issuedAt: 1_000,
          reason: "test",
          sessionId: "session-1",
          target: "athena_surface",
        },
        topic: "controlIntents",
      });
    });

    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "controlResults" }),
    );
  });

  it("publishes control results before applying navigation-causing clicks", async () => {
    const onClick = vi.fn();
    document.body.innerHTML = `<a aria-label="Point of Sale" data-remote-assist-control="pos-home" href="/wigclub/store/wigclub/pos">Point of Sale</a>`;
    const link = document.querySelector("a")!;
    link.getBoundingClientRect = () =>
      ({
        bottom: 40,
        height: 30,
        left: 10,
        right: 150,
        toJSON: () => ({}),
        top: 10,
        width: 140,
        x: 10,
        y: 10,
      }) as DOMRect;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      onClick();
    });
    document.elementFromPoint = vi.fn(() => link) as typeof document.elementFromPoint;
    const client = createFakeClient();
    client.publish.mockImplementation(async () => {
      expect(onClick).not.toHaveBeenCalled();
    });
    const clientFactory = vi.fn(() => client);

    renderHook(() =>
      useRemoteAssistRuntimeTransport({
        clientFactory,
        enabled: true,
        session: activeSession(),
        storeId: "store-1",
        syncSecretHash: "sync-hash",
        terminalId: "terminal-1",
      }),
    );
    await waitFor(() => expect(client.connect).toHaveBeenCalled());
    client.publish.mockClear();

    act(() => {
      client.emitMessage({
        payload: {
          event: {
            action: "up",
            pointerId: "support-pointer",
            type: "pointer",
            x: 20,
            y: 20,
          },
          idempotencyKey: "intent-navigation-1",
          issuedAt: 1_000,
          reason: "test",
          sessionId: "session-1",
          target: "athena_surface",
        },
        topic: "controlIntents",
      });
    });

    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          accepted: true,
          idempotencyKey: "intent-navigation-1",
        }),
        topic: "controlResults",
      }),
    );
  });

  it("ignores control intents for sensitive, attended, and non-active sessions", async () => {
    const cases = [
      activeSession({ sensitiveModeActive: true }),
      activeSession({ effectiveMode: "attended" }),
      activeSession({ status: "connecting" }),
      activeSession({ status: "ended" }),
    ];

    for (const session of cases) {
      requestCredentialMock.mockClear();
      requestCredentialMock.mockResolvedValue({
        data: credential,
        kind: "ok",
      });
      const onClick = vi.fn();
      document.body.innerHTML = `<button aria-label="Checkout" data-remote-assist-control="checkout">Checkout</button>`;
      const button = document.querySelector("button")!;
      button.addEventListener("click", onClick);
      document.elementFromPoint = vi.fn(() => button) as typeof document.elementFromPoint;
      const client = createFakeClient();
      const clientFactory = vi.fn(() => client);

      const { unmount } = renderHook(() =>
        useRemoteAssistRuntimeTransport({
          clientFactory,
          enabled: true,
          session,
          storeId: "store-1",
          syncSecretHash: "sync-hash",
          terminalId: "terminal-1",
        }),
      );
      await waitFor(() => expect(client.connect).toHaveBeenCalled());
      client.publish.mockClear();

      act(() => {
        client.emitMessage({
          payload: {
            event: {
              action: "up",
              pointerId: "support-pointer",
              type: "pointer",
              x: 20,
              y: 20,
            },
            idempotencyKey: `intent-${session.status}-${session.effectiveMode}-${session.sensitiveModeActive}`,
            issuedAt: 1_000,
            reason: "test",
            sessionId: "session-1",
            target: "athena_surface",
          },
          topic: "controlIntents",
        });
      });

      expect(onClick).not.toHaveBeenCalled();
      expect(client.publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ topic: "controlResults" }),
      );
      unmount();
    }
  });
});

function activeSession(
  args: {
    effectiveMode?: string;
    sensitiveModeActive?: boolean;
    status?: string;
  } = {},
) {
  return {
    _id: "session-1",
    effectiveMode: args.effectiveMode ?? "unattended",
    sensitiveModeActive: args.sensitiveModeActive ?? false,
    status: args.status ?? "active",
  };
}

function createFakeClient(args: { onConnect?: () => void } = {}) {
  let messageHandler: ((message: RemoteAssistTransportMessage) => void) | null = null;
  let stateHandler:
    | ((state: RemoteAssistTransportConnectionState) => void)
    | null = null;
  const client = {
    connect: vi.fn(async () => {
      args.onConnect?.();
    }),
    disconnect: vi.fn(async () => undefined),
    emitMessage: (message: RemoteAssistTransportMessage) => {
      messageHandler?.(message);
    },
    emitState: (state: RemoteAssistTransportConnectionState) => {
      stateHandler?.(state);
    },
    publish: vi.fn(async () => undefined),
    subscribe: vi.fn((handler: (message: RemoteAssistTransportMessage) => void) => {
      messageHandler = handler;
      return () => {
        messageHandler = null;
      };
    }),
    subscribeToConnectionState: vi.fn(
      (handler: (state: RemoteAssistTransportConnectionState) => void) => {
        stateHandler = handler;
        return () => {
          stateHandler = null;
        };
      },
    ),
  };

  return client as unknown as RemoteAssistLiveTransportClient & {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    emitMessage: (message: RemoteAssistTransportMessage) => void;
    emitState: (state: RemoteAssistTransportConnectionState) => void;
    publish: ReturnType<typeof vi.fn>;
  };
}

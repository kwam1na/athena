import { useAction } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  prepareRemoteAssistControlIntent,
} from "./applyRemoteAssistControlIntent";
import { captureRemoteAssistCoBrowseFrame } from "./remoteAssistCobrowseRecorder";
import {
  createRemoteAssistTransportClient,
} from "../transport/createRemoteAssistTransportClient";
import type {
  RemoteAssistLiveTransportClient,
  RemoteAssistLiveTransportClientFactory,
  RemoteAssistTransportConnectionState,
  RemoteAssistTransportCredential,
  RemoteAssistTransportMessage,
} from "../transport/RemoteAssistLiveTransportClient";
import type { RemoteAssistRuntimeLiveState } from "@/lib/remote-assist";

type RemoteAssistRuntimeTransportSession = {
  _id: Id<"remoteAssistSession"> | string;
  effectiveMode: "attended" | "unattended" | string;
  sensitiveModeActive: boolean;
  status: string;
};

export function useRemoteAssistRuntimeTransport(args: {
  clientFactory?: RemoteAssistLiveTransportClientFactory;
  enabled: boolean;
  session: RemoteAssistRuntimeTransportSession | null | undefined;
  storeId?: Id<"store"> | string;
  syncSecretHash?: string;
  terminalId?: Id<"posTerminal"> | string;
}) {
  const requestCredential = useAction(
    api.remoteAssist.transport.requestRuntimeCredential,
  );
  const clientFactory = args.clientFactory ?? createRemoteAssistTransportClient;
  const [connectionState, setConnectionState] =
    useState<RemoteAssistTransportConnectionState>("idle");
  const clientRef = useRef<RemoteAssistLiveTransportClient | null>(null);
  const frameCounterRef = useRef(0);
  const liveStateRef = useRef<RemoteAssistRuntimeLiveState | null>(null);
  const sessionId = args.session?._id ? String(args.session._id) : null;
  const controlEnabled =
    args.session?.status === "active" &&
    args.session.effectiveMode === "unattended" &&
    !args.session.sensitiveModeActive;
  const liveState = useMemo<RemoteAssistRuntimeLiveState | null>(() => {
    if (!args.session || !sessionId) {
      return null;
    }
    return {
      connectedSupportCount: 0,
      localDisconnectAvailable: true,
      route: window.location.pathname || "/",
      sensitiveModeActive: args.session.sensitiveModeActive,
      sessionId,
      status:
        args.session.status === "pending_attended_approval"
          ? "waiting_approval"
          : args.session.status === "active"
            ? "active"
            : args.session.status === "connecting"
              ? "connecting"
              : "ended",
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth,
      },
    };
  }, [args.session, sessionId]);

  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  useEffect(() => {
    if (
      !args.enabled ||
      !args.session ||
      !sessionId ||
      !args.storeId ||
      !args.syncSecretHash ||
      !args.terminalId
    ) {
      return;
    }

    let disposed = false;
    let cleanupMessageSubscription: (() => void) | undefined;
    let cleanupStateSubscription: (() => void) | undefined;
    let frameTimerId: number | undefined;
    let stateTimerId: number | undefined;

    async function connectRuntime() {
      const currentSessionId = sessionId;
      if (!currentSessionId) {
        return;
      }
      const credentialResult = await requestCredential({
        sessionId: args.session!._id as Id<"remoteAssistSession">,
        storeId: args.storeId as Id<"store">,
        syncSecretHash: args.syncSecretHash!,
        terminalId: args.terminalId as Id<"posTerminal">,
      });
      if (disposed || credentialResult.kind !== "ok") {
        setConnectionState("error");
        return;
      }

      const client = clientFactory();
      clientRef.current = client;
      cleanupStateSubscription = client.subscribeToConnectionState(setConnectionState);
      cleanupMessageSubscription = client.subscribe((message) => {
        if (message.topic !== "controlIntents" || !controlEnabled) {
          return;
        }
        const prepared = prepareRemoteAssistControlIntent({
          intent: message.payload,
        });
        void publishControlResultThenApply(client, prepared);
      });

      await client.connect(credentialResult.data as RemoteAssistTransportCredential);
      publishRuntimeFrame(client, currentSessionId);
      publishRuntimeState(client, liveStateRef.current);
      frameTimerId = window.setInterval(
        () => publishRuntimeFrame(client, currentSessionId),
        1_000,
      );
      stateTimerId = window.setInterval(
        () => publishRuntimeState(client, liveStateRef.current),
        2_000,
      );
    }

    void connectRuntime().catch(() => {
      if (!disposed) {
        setConnectionState("error");
      }
    });

    return () => {
      disposed = true;
      cleanupMessageSubscription?.();
      cleanupStateSubscription?.();
      if (frameTimerId) {
        window.clearInterval(frameTimerId);
      }
      if (stateTimerId) {
        window.clearInterval(stateTimerId);
      }
      const client = clientRef.current;
      clientRef.current = null;
      void client?.disconnect();
    };
  }, [
    args.enabled,
    args.session,
    args.storeId,
    args.syncSecretHash,
    args.terminalId,
    clientFactory,
    controlEnabled,
    requestCredential,
    sessionId,
  ]);

  function publishRuntimeFrame(
    client: RemoteAssistLiveTransportClient,
    currentSessionId: string,
  ) {
    frameCounterRef.current += 1;
    const frame = captureRemoteAssistCoBrowseFrame({
      frameId: `${currentSessionId}-${frameCounterRef.current}`,
      sessionId: currentSessionId,
    });
    void client.publish({
      payload: frame,
      topic: "runtimeFrames",
    });
  }

  return {
    connectionState,
  };
}

async function publishControlResultThenApply(
  client: RemoteAssistLiveTransportClient,
  prepared: ReturnType<typeof prepareRemoteAssistControlIntent>,
) {
  await client.publish({
    payload: prepared.result,
    topic: "controlResults",
  });
  prepared.apply();
}

function publishRuntimeState(
  client: RemoteAssistLiveTransportClient,
  liveState: RemoteAssistRuntimeLiveState | null,
) {
  if (!liveState) {
    return;
  }
  void client.publish({
    payload: liveState,
    topic: "runtimeState",
  } satisfies RemoteAssistTransportMessage);
}

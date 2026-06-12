import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type {
  RemoteAssistCoBrowseFrame,
  RemoteAssistControlIntent,
  RemoteAssistControlResult,
  RemoteAssistRuntimeLiveState,
} from "@/lib/remote-assist";
import { createRemoteAssistTransportClient } from "../transport/createRemoteAssistTransportClient";
import type {
  RemoteAssistLiveTransportClient,
  RemoteAssistLiveTransportClientFactory,
  RemoteAssistTransportConnectionState,
  RemoteAssistTransportCredential,
} from "../transport/RemoteAssistLiveTransportClient";

export function useRemoteAssistSupportTransport(args: {
  clientFactory?: RemoteAssistLiveTransportClientFactory;
  enabled: boolean;
  sessionId?: Id<"remoteAssistSession"> | string;
}) {
  const requestCredential = useAction(
    api.remoteAssist.transport.requestSupportCredential,
  );
  const clientFactory = args.clientFactory ?? createRemoteAssistTransportClient;
  const [connectionState, setConnectionState] =
    useState<RemoteAssistTransportConnectionState>("idle");
  const [latestFrame, setLatestFrame] =
    useState<RemoteAssistCoBrowseFrame | null>(null);
  const [runtimeState, setRuntimeState] =
    useState<RemoteAssistRuntimeLiveState | null>(null);
  const [latestControlResult, setLatestControlResult] =
    useState<RemoteAssistControlResult | null>(null);
  const clientRef = useRef<RemoteAssistLiveTransportClient | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!args.enabled || !args.sessionId) {
      return;
    }

    let disposed = false;
    let cleanupMessageSubscription: (() => void) | undefined;
    let cleanupStateSubscription: (() => void) | undefined;

    async function connectSupport() {
      const credentialResult = await requestCredential({
        sessionId: args.sessionId as Id<"remoteAssistSession">,
      });
      if (disposed || credentialResult.kind !== "ok") {
        setConnectionState("error");
        return;
      }

      const client = clientFactory();
      clientRef.current = client;
      cleanupStateSubscription = client.subscribeToConnectionState(setConnectionState);
      cleanupMessageSubscription = client.subscribe((message) => {
        if (message.topic === "runtimeFrames") {
          setLatestFrame(message.payload);
        } else if (message.topic === "runtimeState") {
          setRuntimeState(message.payload);
        } else if (message.topic === "controlResults") {
          setLatestControlResult(message.payload);
        }
      });
      await client.connect(credentialResult.data as RemoteAssistTransportCredential);
    }

    void connectSupport().catch(() => {
      if (!disposed) {
        setConnectionState("error");
      }
    });

    return () => {
      disposed = true;
      cleanupMessageSubscription?.();
      cleanupStateSubscription?.();
      const client = clientRef.current;
      clientRef.current = null;
      void client?.disconnect();
    };
  }, [args.enabled, args.sessionId, clientFactory, refreshKey, requestCredential]);

  const sendControlIntent = useCallback(
    async (intent: RemoteAssistControlIntent) => {
      await clientRef.current?.publish({
        payload: intent,
        topic: "controlIntents",
      });
    },
    [],
  );

  return {
    connectionState,
    latestControlResult,
    latestFrame,
    reconnect: () => setRefreshKey((current) => current + 1),
    runtimeState,
    sendControlIntent,
  };
}

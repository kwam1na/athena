import type {
  RemoteAssistCoBrowseFrame,
  RemoteAssistControlIntent,
  RemoteAssistControlResult,
  RemoteAssistRuntimeLiveState,
} from "@/lib/remote-assist";

export type RemoteAssistTransportCredential = {
  expiresAt: number;
  participantIdentity: string;
  participantRole: "runtime" | "support";
  provider: RemoteAssistTransportProviderId;
  roomId: string;
  sessionId: string;
  token: string;
  topics: RemoteAssistTransportTopics;
  url: string;
};

export type RemoteAssistTransportProviderId = "livekit";

export type RemoteAssistTransportTopics = {
  controlIntents: string;
  controlResults: string;
  runtimeFrames: string;
  runtimeState: string;
};

export type RemoteAssistTransportMessage =
  | {
      payload: RemoteAssistCoBrowseFrame;
      topic: "runtimeFrames";
    }
  | {
      payload: RemoteAssistRuntimeLiveState;
      topic: "runtimeState";
    }
  | {
      payload: RemoteAssistControlIntent;
      topic: "controlIntents";
    }
  | {
      payload: RemoteAssistControlResult;
      topic: "controlResults";
    };

export type RemoteAssistTransportConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type RemoteAssistLiveTransportClient = {
  connect: (credential: RemoteAssistTransportCredential) => Promise<void>;
  disconnect: () => Promise<void>;
  publish: (message: RemoteAssistTransportMessage) => Promise<void>;
  subscribe: (
    handler: (message: RemoteAssistTransportMessage) => void,
  ) => () => void;
  subscribeToConnectionState: (
    handler: (state: RemoteAssistTransportConnectionState) => void,
  ) => () => void;
};

export type RemoteAssistLiveTransportClientFactory = () => RemoteAssistLiveTransportClient;

export type RemoteAssistLiveTransportClientRegistry = Record<
  RemoteAssistTransportProviderId,
  RemoteAssistLiveTransportClientFactory
>;

export function parseRemoteAssistTransportMessage(
  rawPayload: unknown,
): RemoteAssistTransportMessage | null {
  if (!isRecord(rawPayload) || typeof rawPayload.topic !== "string") {
    return null;
  }

  if (
    rawPayload.topic === "runtimeFrames" ||
    rawPayload.topic === "runtimeState" ||
    rawPayload.topic === "controlIntents" ||
    rawPayload.topic === "controlResults"
  ) {
    return {
      payload: rawPayload.payload as never,
      topic: rawPayload.topic,
    } as RemoteAssistTransportMessage;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import {
  DataPacket_Kind,
  Room,
  RoomEvent,
  type RemoteParticipant,
} from "livekit-client";

import {
  parseRemoteAssistTransportMessage,
  type RemoteAssistLiveTransportClient,
  type RemoteAssistTransportConnectionState,
  type RemoteAssistTransportCredential,
  type RemoteAssistTransportMessage,
} from "./RemoteAssistLiveTransportClient";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function createLiveKitRemoteAssistClient(): RemoteAssistLiveTransportClient {
  return new LiveKitRemoteAssistClient();
}

class LiveKitRemoteAssistClient implements RemoteAssistLiveTransportClient {
  private credential: RemoteAssistTransportCredential | null = null;
  private readonly messageHandlers = new Set<
    (message: RemoteAssistTransportMessage) => void
  >();
  private readonly stateHandlers = new Set<
    (state: RemoteAssistTransportConnectionState) => void
  >();
  private room: Room | null = null;

  async connect(credential: RemoteAssistTransportCredential) {
    await this.disconnect();
    this.credential = credential;
    this.emitState("connecting");

    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
    });
    this.room = room;
    room.on(RoomEvent.DataReceived, this.handleDataReceived);
    room.on(RoomEvent.Disconnected, () => this.emitState("disconnected"));
    room.on(RoomEvent.Reconnecting, () => this.emitState("reconnecting"));
    room.on(RoomEvent.Reconnected, () => this.emitState("connected"));

    try {
      await room.connect(credential.url, credential.token, {
        autoSubscribe: true,
      });
      this.emitState("connected");
    } catch (error) {
      this.emitState("error");
      throw error;
    }
  }

  async disconnect() {
    const room = this.room;
    this.room = null;
    if (!room) {
      this.emitState("idle");
      return;
    }
    room.off(RoomEvent.DataReceived, this.handleDataReceived);
    await room.disconnect();
    this.emitState("disconnected");
  }

  async publish(message: RemoteAssistTransportMessage) {
    if (!this.room || !this.credential) {
      return;
    }
    const payload = textEncoder.encode(
      JSON.stringify({
        payload: message.payload,
        topic: message.topic,
      }),
    );
    await this.room.localParticipant.publishData(payload, {
      ...getDataPublishRouting({
        credential: this.credential,
        message,
      }),
      reliable: true,
      topic: this.credential.topics[message.topic],
    });
  }

  subscribe(handler: (message: RemoteAssistTransportMessage) => void) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  subscribeToConnectionState(
    handler: (state: RemoteAssistTransportConnectionState) => void,
  ) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private readonly handleDataReceived = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    _kind?: DataPacket_Kind,
    topic?: string,
  ) => {
    if (!this.credential || !Object.values(this.credential.topics).includes(topic ?? "")) {
      return;
    }

    try {
      const parsed = parseRemoteAssistTransportMessage(
        JSON.parse(textDecoder.decode(payload)),
      );
      if (
        !parsed ||
        topic !== this.credential.topics[parsed.topic] ||
        !isAllowedSender({
          credential: this.credential,
          message: parsed,
          participant,
        })
      ) {
        return;
      }
      for (const handler of this.messageHandlers) {
        handler(parsed);
      }
    } catch {
      // Ignore malformed packets from the room; Remote Assist messages are best-effort live state.
    }
  };

  private emitState(state: RemoteAssistTransportConnectionState) {
    for (const handler of this.stateHandlers) {
      handler(state);
    }
  }
}

function getDataPublishRouting(args: {
  credential: RemoteAssistTransportCredential;
  message: RemoteAssistTransportMessage;
}) {
  if (
    args.credential.participantRole === "support" &&
    args.message.topic === "controlIntents"
  ) {
    return {
      destinationIdentities: [
        buildParticipantIdentity({
          clientId: args.credential.clientId,
          participantRole: "runtime",
          sessionId: args.credential.sessionId,
        }),
      ],
    };
  }
  return {};
}

function buildParticipantIdentity(args: {
  clientId: string;
  participantRole: "runtime" | "support";
  sessionId: string;
}) {
  return [
    "remote-assist",
    args.sessionId,
    args.participantRole,
    args.clientId,
  ]
    .join(":")
    .replace(/[^A-Za-z0-9:_-]/g, "_");
}

function isAllowedSender(args: {
  credential: RemoteAssistTransportCredential;
  message: RemoteAssistTransportMessage;
  participant?: RemoteParticipant;
}) {
  const senderRole = getParticipantRole(args.participant);

  if (
    args.message.topic === "controlIntents" &&
    args.credential.participantRole === "runtime"
  ) {
    return senderRole === "support";
  }

  if (
    (args.message.topic === "runtimeFrames" ||
      args.message.topic === "runtimeState") &&
    args.credential.participantRole === "support"
  ) {
    return senderRole === "runtime";
  }

  if (
    args.message.topic === "controlResults" &&
    args.credential.participantRole === "support"
  ) {
    return senderRole === "runtime";
  }

  return false;
}

function getParticipantRole(participant?: RemoteParticipant) {
  const metadataRole = parseParticipantRole(participant?.metadata);
  if (metadataRole) {
    return metadataRole;
  }

  const identityParts = participant?.identity.split(":") ?? [];
  return parseParticipantRole(identityParts[2]);
}

function parseParticipantRole(value: unknown): "runtime" | "support" | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as { participantRole?: unknown };
    if (
      parsed.participantRole === "runtime" ||
      parsed.participantRole === "support"
    ) {
      return parsed.participantRole;
    }
  } catch {
    // Fall through to raw role parsing.
  }
  return value === "runtime" || value === "support" ? value : null;
}

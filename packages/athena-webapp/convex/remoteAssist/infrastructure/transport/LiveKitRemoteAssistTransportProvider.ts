"use node";

import {
  AccessToken,
  RoomServiceClient,
  type VideoGrant,
} from "livekit-server-sdk";

import {
  type RemoteAssistTransportCredential,
} from "../../application/types";
import type {
  RemoteAssistTransportProvider,
  RemoteAssistTransportTokenRequest,
} from "./RemoteAssistTransportProvider";

const DEFAULT_ROOM_EMPTY_TIMEOUT_SECONDS = 60;
const DEFAULT_ROOM_DEPARTURE_TIMEOUT_SECONDS = 30;
const DEFAULT_ROOM_MAX_PARTICIPANTS = 3;

type LiveKitConfig = {
  apiKey: string;
  apiSecret: string;
  url: string;
};

export class LiveKitRemoteAssistTransportProvider
  implements RemoteAssistTransportProvider
{
  constructor(private readonly config: LiveKitConfig = getLiveKitConfig()) {}

  async issueCredential(
    request: RemoteAssistTransportTokenRequest,
  ): Promise<RemoteAssistTransportCredential> {
    await this.ensureRoom(request.context.roomId);

    const token = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: request.context.participantIdentity,
      metadata: JSON.stringify({
        participantRole: request.context.participantRole,
        sessionId: request.context.sessionId,
      }),
      ttl: request.ttlSeconds,
    });
    token.addGrant(buildGrant(request.context.participantRole, request.context.roomId));

    return {
      ...request.context,
      token: await token.toJwt(),
      url: this.config.url,
    };
  }

  private async ensureRoom(roomId: string) {
    const roomService = new RoomServiceClient(
      this.config.url,
      this.config.apiKey,
      this.config.apiSecret,
    );
    try {
      await roomService.createRoom({
        departureTimeout: DEFAULT_ROOM_DEPARTURE_TIMEOUT_SECONDS,
        emptyTimeout: DEFAULT_ROOM_EMPTY_TIMEOUT_SECONDS,
        maxParticipants: DEFAULT_ROOM_MAX_PARTICIPANTS,
        metadata: JSON.stringify({ product: "athena-remote-assist" }),
        name: roomId,
      });
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return;
      }
      throw error;
    }
  }
}

export function getLiveKitConfig(): LiveKitConfig {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL ?? process.env.LIVEKIT_HOST;

  if (!apiKey || !apiSecret || !url) {
    throw new Error("Remote Assist transport provider is not configured.");
  }

  return {
    apiKey,
    apiSecret,
    url,
  };
}

function buildGrant(
  participantRole: "support" | "runtime",
  roomId: string,
): VideoGrant {
  return {
    canPublish: false,
    canPublishData: true,
    canSubscribe: true,
    room: roomId,
    roomJoin: true,
  };
}

function isAlreadyExistsError(error: unknown) {
  return (
    error instanceof Error &&
    /already exists|already_exists|409/i.test(error.message)
  );
}

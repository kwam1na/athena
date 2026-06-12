import { createLiveKitRemoteAssistClient } from "./livekitRemoteAssistClient";
import type {
  RemoteAssistLiveTransportClient,
  RemoteAssistLiveTransportClientFactory,
  RemoteAssistLiveTransportClientRegistry,
  RemoteAssistTransportProviderId,
} from "./RemoteAssistLiveTransportClient";

const remoteAssistTransportClientRegistry: RemoteAssistLiveTransportClientRegistry = {
  livekit: createLiveKitRemoteAssistClient,
};

export function createRemoteAssistTransportClient(
  provider: RemoteAssistTransportProviderId = "livekit",
): RemoteAssistLiveTransportClient {
  return getRemoteAssistTransportClientFactory(provider)();
}

export function getRemoteAssistTransportClientFactory(
  provider: RemoteAssistTransportProviderId,
): RemoteAssistLiveTransportClientFactory {
  return remoteAssistTransportClientRegistry[provider];
}

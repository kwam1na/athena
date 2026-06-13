import type {
  RemoteAssistLiveTransportClient,
  RemoteAssistLiveTransportClientFactory,
  RemoteAssistLiveTransportClientRegistry,
  RemoteAssistTransportConnectionState,
  RemoteAssistTransportCredential,
  RemoteAssistTransportMessage,
  RemoteAssistTransportProviderId,
} from "./RemoteAssistLiveTransportClient";

const remoteAssistTransportClientRegistry: RemoteAssistLiveTransportClientRegistry = {
  livekit: () => new LazyLiveKitRemoteAssistClient(),
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

class LazyLiveKitRemoteAssistClient implements RemoteAssistLiveTransportClient {
  private activeConnectionId = 0;
  private client: RemoteAssistLiveTransportClient | null = null;
  private clientLoad: Promise<RemoteAssistLiveTransportClient> | null = null;
  private readonly messageHandlers = new Set<
    (message: RemoteAssistTransportMessage) => void
  >();
  private readonly stateHandlers = new Set<
    (state: RemoteAssistTransportConnectionState) => void
  >();

  async connect(credential: RemoteAssistTransportCredential) {
    const connectionId = ++this.activeConnectionId;
    const client = await this.loadClient();
    if (connectionId !== this.activeConnectionId) {
      await client.disconnect();
      return;
    }
    await client.connect(credential);
  }

  async disconnect() {
    this.activeConnectionId += 1;
    await this.client?.disconnect();
  }

  async publish(message: RemoteAssistTransportMessage) {
    await this.client?.publish(message);
  }

  subscribe(handler: (message: RemoteAssistTransportMessage) => void) {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  subscribeToConnectionState(
    handler: (state: RemoteAssistTransportConnectionState) => void,
  ) {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  private async loadClient() {
    if (!this.clientLoad) {
      this.clientLoad = import("./livekitRemoteAssistClient").then(
        ({ createLiveKitRemoteAssistClient }) => {
          const client = createLiveKitRemoteAssistClient();
          this.client = client;
          client.subscribe((message) => {
            for (const handler of this.messageHandlers) {
              handler(message);
            }
          });
          client.subscribeToConnectionState((state) => {
            for (const handler of this.stateHandlers) {
              handler(state);
            }
          });
          return client;
        },
      );
    }

    return this.clientLoad;
  }
}

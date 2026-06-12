"use node";

import type { RemoteAssistTransportProvider as RemoteAssistTransportProviderId } from "../../application/types";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this Node-runtime provider factory selects the concrete SDK adapter.
import { LiveKitRemoteAssistTransportProvider } from "./LiveKitRemoteAssistTransportProvider";
import type { RemoteAssistTransportProvider } from "./RemoteAssistTransportProvider";

export function createRemoteAssistTransportProvider(
  provider: RemoteAssistTransportProviderId = "livekit",
): RemoteAssistTransportProvider {
  if (provider !== "livekit") {
    throw new Error(`Remote Assist transport provider ${provider} is not configured.`);
  }

  return new LiveKitRemoteAssistTransportProvider();
}

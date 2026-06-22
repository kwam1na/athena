import type {
  ContextTrackingEnvelope,
  TrackContextEventResult,
} from "@athena/webapp/shared/intelligence";

import config from "@/config";

export async function postTrackingEvent(
  envelope: ContextTrackingEnvelope,
): Promise<TrackContextEventResult> {
  const response = await fetch(`${config.apiGateway.URL}/tracking-events`, {
    method: "POST",
    body: JSON.stringify(envelope),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Error posting tracking event.");
  }

  return result as TrackContextEventResult;
}

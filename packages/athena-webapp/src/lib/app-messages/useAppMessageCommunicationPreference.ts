import { useContext, useEffect } from "react";

import { AppMessagesContext } from "./AppMessagesContext";
import {
  DEFAULT_APP_MESSAGE_COMMUNICATION_VARIANT,
  type AppMessageCommunicationPreferenceInput,
} from "./appMessageCommunicationPreferenceContext";

export function usePreferredAppMessageCommunicationVariant() {
  return (
    useContext(AppMessagesContext)?.communicationVariant ??
    DEFAULT_APP_MESSAGE_COMMUNICATION_VARIANT
  );
}

export function useAppMessageCommunicationPreference({
  enabled = true,
  surfaceId,
  variant,
}: AppMessageCommunicationPreferenceInput) {
  const registerPreference = useContext(AppMessagesContext)
    ?.registerCommunicationPreference;

  useEffect(() => {
    if (!enabled || !registerPreference) {
      return undefined;
    }

    return registerPreference({ surfaceId, variant });
  }, [enabled, registerPreference, surfaceId, variant]);
}

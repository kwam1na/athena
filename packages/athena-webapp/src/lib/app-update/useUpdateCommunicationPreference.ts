import { useContext, useEffect } from "react";

import {
  DEFAULT_UPDATE_COMMUNICATION_VARIANT,
  UpdateCommunicationPreferenceContext,
  type UpdateCommunicationPreferenceInput,
} from "./updateCommunicationPreferenceContext";

export function usePreferredUpdateCommunicationVariant() {
  return (
    useContext(UpdateCommunicationPreferenceContext)?.variant ??
    DEFAULT_UPDATE_COMMUNICATION_VARIANT
  );
}

export function useUpdateCommunicationPreference({
  enabled = true,
  surfaceId,
  variant,
}: UpdateCommunicationPreferenceInput) {
  const registerPreference = useContext(UpdateCommunicationPreferenceContext)
    ?.registerPreference;

  useEffect(() => {
    if (!enabled || !registerPreference) {
      return undefined;
    }

    return registerPreference({ surfaceId, variant });
  }, [enabled, registerPreference, surfaceId, variant]);
}

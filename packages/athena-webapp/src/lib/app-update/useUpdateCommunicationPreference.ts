import {
  useAppMessageCommunicationPreference,
  usePreferredAppMessageCommunicationVariant,
} from "@/lib/app-messages";
import type { UpdateCommunicationPreferenceInput } from "./updateCommunicationPreferenceContext";

export function usePreferredUpdateCommunicationVariant() {
  return usePreferredAppMessageCommunicationVariant();
}

export function useUpdateCommunicationPreference({
  enabled = true,
  surfaceId,
  variant,
}: UpdateCommunicationPreferenceInput) {
  useAppMessageCommunicationPreference({ enabled, surfaceId, variant });
}

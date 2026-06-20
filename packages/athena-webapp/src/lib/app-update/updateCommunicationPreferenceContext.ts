import { createContext } from "react";

export type UpdateCommunicationVariant = "ghost" | "banner" | "toast";

export type UpdateCommunicationPreferenceInput = {
  surfaceId: string;
  variant: UpdateCommunicationVariant;
  enabled?: boolean;
};

export type UpdateCommunicationPreferenceContextValue = {
  variant: UpdateCommunicationVariant;
  registerPreference: (
    input: Required<Omit<UpdateCommunicationPreferenceInput, "enabled">>,
  ) => () => void;
};

export const DEFAULT_UPDATE_COMMUNICATION_VARIANT: UpdateCommunicationVariant =
  "ghost";

export const UpdateCommunicationPreferenceContext =
  createContext<UpdateCommunicationPreferenceContextValue | null>(null);

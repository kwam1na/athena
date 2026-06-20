import {
  DEFAULT_APP_MESSAGE_COMMUNICATION_VARIANT,
  type AppMessageCommunicationPreferenceInput,
  type AppMessageCommunicationVariant,
} from "@/lib/app-messages";

export type UpdateCommunicationVariant = AppMessageCommunicationVariant;

export type UpdateCommunicationPreferenceInput =
  AppMessageCommunicationPreferenceInput;

export type UpdateCommunicationPreferenceContextValue = {
  variant: UpdateCommunicationVariant;
  registerPreference: (
    input: Required<Omit<UpdateCommunicationPreferenceInput, "enabled">>,
  ) => () => void;
};

export const DEFAULT_UPDATE_COMMUNICATION_VARIANT: UpdateCommunicationVariant =
  DEFAULT_APP_MESSAGE_COMMUNICATION_VARIANT;

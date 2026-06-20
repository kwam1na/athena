export type AppMessageCommunicationVariant = "ghost" | "banner" | "toast";

export type AppMessageCommunicationPreferenceInput = {
  surfaceId: string;
  variant: AppMessageCommunicationVariant;
  enabled?: boolean;
};

export const DEFAULT_APP_MESSAGE_COMMUNICATION_VARIANT: AppMessageCommunicationVariant =
  "ghost";

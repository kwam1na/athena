import { createContext } from "react";

import type { AppActionBlocker, AppActionBlockerInput } from "./appActionBlockers";
import type { AppMessage, AppMessageInput } from "./appMessages";
import type {
  AppMessageCommunicationPreferenceInput,
  AppMessageCommunicationVariant,
} from "./appMessageCommunicationPreferenceContext";

export type AppMessagesContextValue = {
  messages: AppMessage[];
  registerMessage: (input: AppMessageInput) => () => void;
  actionBlockers: Map<string, AppActionBlocker[]>;
  registerActionBlocker: (input: AppActionBlockerInput) => () => void;
  communicationVariant: AppMessageCommunicationVariant;
  registerCommunicationPreference: (
    input: Required<Omit<AppMessageCommunicationPreferenceInput, "enabled">>,
  ) => () => void;
};

export const AppMessagesContext =
  createContext<AppMessagesContextValue | null>(null);

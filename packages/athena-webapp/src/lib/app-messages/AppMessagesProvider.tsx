import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  isValidAppActionBlockerInput,
  sortAppActionBlockers,
  type AppActionBlocker,
  type AppActionBlockerInput,
} from "./appActionBlockers";
import {
  isValidAppMessageInput,
  sortAppMessages,
  type AppMessage,
  type AppMessageInput,
} from "./appMessages";
import { AppMessagesContext, type AppMessagesContextValue } from "./AppMessagesContext";
import {
  DEFAULT_APP_MESSAGE_COMMUNICATION_VARIANT,
  type AppMessageCommunicationVariant,
} from "./appMessageCommunicationPreferenceContext";

type ActionBlockerState = Map<string, Map<string, AppActionBlocker>>;

export function AppMessagesProvider({ children }: { children: ReactNode }) {
  const [messageState, setMessageState] = useState<Map<string, AppMessage>>(
    () => new Map(),
  );
  const [actionBlockerState, setActionBlockerState] =
    useState<ActionBlockerState>(() => new Map());
  const [communicationPreferences, setCommunicationPreferences] = useState<
    Map<string, AppMessageCommunicationVariant>
  >(() => new Map());

  const registerMessage = useCallback((input: AppMessageInput) => {
    if (!isValidAppMessageInput(input)) {
      return () => undefined;
    }

    setMessageState((current) => {
      const existing = current.get(input.id);
      if (existing && areMessagesEqual(existing, input)) {
        return current;
      }

      const next = new Map(current);
      next.set(input.id, input);
      return next;
    });

    return () => {
      setMessageState((current) => {
        if (!current.has(input.id)) {
          return current;
        }

        const next = new Map(current);
        next.delete(input.id);
        return next;
      });
    };
  }, []);

  const registerActionBlocker = useCallback(
    (input: AppActionBlockerInput) => {
      if (!isValidAppActionBlockerInput(input)) {
        return () => undefined;
      }

      setActionBlockerState((current) => {
        const currentAction = current.get(input.actionId);
        const currentBlocker = currentAction?.get(input.blockerId);
        if (currentBlocker && areBlockersEqual(currentBlocker, input)) {
          return current;
        }

        const next = new Map(current);
        const nextAction = new Map(currentAction);
        nextAction.set(input.blockerId, input);
        next.set(input.actionId, nextAction);
        return next;
      });

      return () => {
        setActionBlockerState((current) => {
          const currentAction = current.get(input.actionId);
          if (!currentAction?.has(input.blockerId)) {
            return current;
          }

          const next = new Map(current);
          const nextAction = new Map(currentAction);
          nextAction.delete(input.blockerId);
          if (nextAction.size > 0) {
            next.set(input.actionId, nextAction);
          } else {
            next.delete(input.actionId);
          }
          return next;
        });
      };
    },
    [],
  );

  const registerCommunicationPreference = useCallback(
    ({
      surfaceId,
      variant,
    }: Parameters<
      AppMessagesContextValue["registerCommunicationPreference"]
    >[0]) => {
      setCommunicationPreferences((current) => {
        if (current.get(surfaceId) === variant) {
          return current;
        }

        const next = new Map(current);
        next.set(surfaceId, variant);
        return next;
      });

      return () => {
        setCommunicationPreferences((current) => {
          if (!current.has(surfaceId)) {
            return current;
          }

          const next = new Map(current);
          next.delete(surfaceId);
          return next;
        });
      };
    },
    [],
  );

  const messages = useMemo(
    () => sortAppMessages([...messageState.values()]),
    [messageState],
  );

  const actionBlockers = useMemo(() => {
    const next = new Map<string, AppActionBlocker[]>();
    for (const [actionId, blockers] of actionBlockerState.entries()) {
      next.set(actionId, sortAppActionBlockers([...blockers.values()]));
    }
    return next;
  }, [actionBlockerState]);

  const communicationVariant = useMemo(
    () => getPreferredVariant(communicationPreferences),
    [communicationPreferences],
  );

  const value = useMemo<AppMessagesContextValue>(
    () => ({
      actionBlockers,
      communicationVariant,
      messages,
      registerActionBlocker,
      registerCommunicationPreference,
      registerMessage,
    }),
    [
      actionBlockers,
      communicationVariant,
      messages,
      registerActionBlocker,
      registerCommunicationPreference,
      registerMessage,
    ],
  );

  return (
    <AppMessagesContext.Provider value={value}>
      {children}
    </AppMessagesContext.Provider>
  );
}

function areMessagesEqual(left: AppMessage, right: AppMessage) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.message === right.message &&
    left.compactLabel === right.compactLabel &&
    left.details === right.details &&
    left.detailsLabel === right.detailsLabel &&
    left.priority === right.priority &&
    left.toastId === right.toastId &&
    left.action?.actionId === right.action?.actionId &&
    left.action?.label === right.action?.label &&
    left.action?.disabled === right.action?.disabled &&
    left.action?.iconName === right.action?.iconName &&
    left.action?.onInvoke === right.action?.onInvoke
  );
}

function getPreferredVariant(
  preferences: Map<string, AppMessageCommunicationVariant>,
) {
  let preferred = DEFAULT_APP_MESSAGE_COMMUNICATION_VARIANT;

  for (const variant of preferences.values()) {
    preferred = variant;
  }

  return preferred;
}

function areBlockersEqual(
  left: AppActionBlocker,
  right: AppActionBlocker,
) {
  return (
    left.actionId === right.actionId &&
    left.blockerId === right.blockerId &&
    left.priority === right.priority &&
    left.label === right.label &&
    left.guidance === right.guidance
  );
}

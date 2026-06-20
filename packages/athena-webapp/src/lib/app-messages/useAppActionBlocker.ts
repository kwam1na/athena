import { useContext, useEffect } from "react";

import { AppMessagesContext } from "./AppMessagesContext";
import type { AppActionBlockerInput } from "./appActionBlockers";

export type UseAppActionBlockerInput = AppActionBlockerInput & {
  active: boolean;
};

export function useAppActionBlocker({
  active,
  actionId,
  blockerId,
  priority,
  label,
  guidance,
}: UseAppActionBlockerInput) {
  const registerActionBlocker = useContext(AppMessagesContext)
    ?.registerActionBlocker;

  useEffect(() => {
    if (!active || !registerActionBlocker) {
      return undefined;
    }

    return registerActionBlocker({
      actionId,
      blockerId,
      priority,
      label,
      guidance,
    });
  }, [
    actionId,
    active,
    blockerId,
    guidance,
    label,
    priority,
    registerActionBlocker,
  ]);
}

export function useAppActionBlockers(actionId: string) {
  return useContext(AppMessagesContext)?.actionBlockers.get(actionId) ?? [];
}

export function useHasAppMessagesProvider() {
  return Boolean(useContext(AppMessagesContext));
}

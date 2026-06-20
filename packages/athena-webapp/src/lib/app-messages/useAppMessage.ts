import { useContext, useEffect } from "react";

import { AppMessagesContext } from "./AppMessagesContext";
import type { AppMessageInput } from "./appMessages";

export type UseAppMessageInput = AppMessageInput & {
  active: boolean;
};

export function useAppMessage({
  active,
  id,
  label,
  message,
  compactLabel,
  details,
  detailsLabel,
  priority,
  toastId,
  action,
}: UseAppMessageInput) {
  const registerMessage = useContext(AppMessagesContext)?.registerMessage;

  useEffect(() => {
    if (!active || !registerMessage) {
      return undefined;
    }

    return registerMessage({
      id,
      label,
      message,
      ...(compactLabel ? { compactLabel } : {}),
      ...(details ? { details } : {}),
      ...(detailsLabel ? { detailsLabel } : {}),
      ...(typeof priority === "number" ? { priority } : {}),
      ...(toastId ? { toastId } : {}),
      ...(action ? { action } : {}),
    });
  }, [
    action,
    active,
    compactLabel,
    details,
    detailsLabel,
    id,
    label,
    message,
    priority,
    registerMessage,
    toastId,
  ]);
}

export function useAppMessages() {
  return useContext(AppMessagesContext)?.messages ?? [];
}

import { useEffect } from "react";

import { useAppActionBlocker } from "@/lib/app-messages";
import { APP_UPDATE_APPLY_ACTION_ID } from "./appUpdateActions";
import { useUpdateCoordinator } from "./UpdateCoordinatorContext";
import type {
  UpdateApplyBlockerPriority,
  UpdateApplyBlockerInput,
} from "./updateCoordinator";

export type UseUpdateApplyBlockerInput = {
  surfaceId: string;
  active: boolean;
  priority: UpdateApplyBlockerPriority;
  label: string;
  guidance: string;
};

export function useUpdateApplyBlocker({
  surfaceId,
  active,
  priority,
  label,
  guidance,
}: UseUpdateApplyBlockerInput) {
  const { registerApplyBlocker, clearApplyBlocker } = useUpdateCoordinator();

  useAppActionBlocker({
    actionId: APP_UPDATE_APPLY_ACTION_ID,
    active,
    blockerId: surfaceId,
    guidance,
    label,
    priority,
  });

  useEffect(() => {
    if (!active) {
      clearApplyBlocker(surfaceId);
      return undefined;
    }

    const blocker: UpdateApplyBlockerInput = {
      surfaceId,
      priority,
      label,
      guidance,
    };
    registerApplyBlocker(blocker);

    return () => clearApplyBlocker(surfaceId);
  }, [
    active,
    clearApplyBlocker,
    guidance,
    label,
    priority,
    registerApplyBlocker,
    surfaceId,
  ]);
}

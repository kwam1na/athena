import { useEffect } from "react";

import { useUpdateCoordinator } from "./UpdateCoordinatorProvider";
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

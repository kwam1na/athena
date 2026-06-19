import { createContext, useContext } from "react";

import type {
  UpdateApplyBlockerInput,
  UpdateApplyOptions,
  UpdateCoordinatorSnapshot,
  UpdateDetectedInput,
} from "./updateCoordinator";

export type UpdateCoordinatorContextValue = {
  snapshot: UpdateCoordinatorSnapshot;
  getSnapshot: () => UpdateCoordinatorSnapshot;
  reportChecking: () => void;
  reportUpdateDetected: (input: UpdateDetectedInput) => void;
  reportDetectorFailed: () => void;
  registerApplyBlocker: (blocker: UpdateApplyBlockerInput) => void;
  clearApplyBlocker: (surfaceId: string) => void;
  applyUpdate: (options?: UpdateApplyOptions) => boolean;
};

export const UpdateCoordinatorContext =
  createContext<UpdateCoordinatorContextValue | null>(null);

export function useUpdateCoordinator() {
  const context = useContext(UpdateCoordinatorContext);
  if (!context) {
    throw new Error(
      "useUpdateCoordinator must be used within UpdateCoordinatorProvider",
    );
  }
  return context;
}

export function useOptionalUpdateCoordinator() {
  return useContext(UpdateCoordinatorContext);
}

export function useUpdateCoordinatorSnapshot() {
  return useUpdateCoordinator().snapshot;
}

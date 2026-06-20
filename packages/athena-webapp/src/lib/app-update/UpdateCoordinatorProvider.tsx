import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createUpdateCoordinatorStore,
  isValidUpdateCoordinatorMessage,
  type UpdateApplyOptions,
  type UpdateCoordinatorStore,
} from "./updateCoordinator";
import { useAppActionBlockers } from "@/lib/app-messages";
import { APP_UPDATE_APPLY_ACTION_ID } from "./appUpdateActions";
import {
  installAppUpdateUnloadPromptBypass,
  reloadBrowserForAppUpdate,
} from "./appUpdateReload";
import {
  UpdateCoordinatorContext,
  type UpdateCoordinatorContextValue,
} from "./UpdateCoordinatorContext";

const CHANNEL_NAME = "athena-update-coordinator";

export function UpdateCoordinatorProvider({
  children,
  reload = reloadBrowserForAppUpdate,
}: {
  children: ReactNode;
  reload?: (options?: UpdateApplyOptions) => void;
}) {
  const storeRef = useRef<UpdateCoordinatorStore | null>(null);
  if (!storeRef.current) {
    installAppUpdateUnloadPromptBypass();
    storeRef.current = createUpdateCoordinatorStore({ reload });
  }
  const store = storeRef.current;
  const applyBlockers = useAppActionBlockers(APP_UPDATE_APPLY_ACTION_ID);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    store.syncApplyBlockers(
      applyBlockers.map((blocker) => ({
        surfaceId: blocker.blockerId,
        priority: blocker.priority,
        label: blocker.label,
        guidance: blocker.guidance,
      })),
    );
  }, [applyBlockers, store]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return undefined;
    }
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (isValidUpdateCoordinatorMessage(event.data)) {
        store.receiveMessage(event.data);
      }
    };

    return () => channel.close();
  }, [store]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }
    const message = store.getMessage();
    if (!message) {
      return;
    }
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(message);
    channel.close();
  }, [snapshot.blockers, snapshot.pendingBuildId, store]);

  const value = useMemo<UpdateCoordinatorContextValue>(
    () => ({
      snapshot,
      getSnapshot: store.getSnapshot,
      reportChecking: store.reportChecking,
      reportUpdateDetected: store.reportUpdateDetected,
      reportDetectorFailed: store.reportDetectorFailed,
      registerApplyBlocker: store.registerApplyBlocker,
      clearApplyBlocker: store.clearApplyBlocker,
      applyUpdate: store.applyUpdate,
    }),
    [snapshot, store],
  );

  return (
    <UpdateCoordinatorContext.Provider value={value}>
      {children}
    </UpdateCoordinatorContext.Provider>
  );
}

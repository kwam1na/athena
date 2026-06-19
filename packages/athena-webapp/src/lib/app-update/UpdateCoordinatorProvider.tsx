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
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

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

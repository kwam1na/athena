import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createUpdateCoordinatorStore,
  isValidUpdateCoordinatorMessage,
  type UpdateApplyBlockerInput,
  type UpdateCoordinatorSnapshot,
  type UpdateCoordinatorStore,
  type UpdateDetectedInput,
} from "./updateCoordinator";

type UpdateCoordinatorContextValue = {
  snapshot: UpdateCoordinatorSnapshot;
  getSnapshot: () => UpdateCoordinatorSnapshot;
  reportChecking: () => void;
  reportUpdateDetected: (input: UpdateDetectedInput) => void;
  reportDetectorFailed: () => void;
  registerApplyBlocker: (blocker: UpdateApplyBlockerInput) => void;
  clearApplyBlocker: (surfaceId: string) => void;
  applyUpdate: () => boolean;
};

const UpdateCoordinatorContext =
  createContext<UpdateCoordinatorContextValue | null>(null);

const CHANNEL_NAME = "athena-update-coordinator";

export function UpdateCoordinatorProvider({
  children,
  reload = () => window.location.reload(),
}: {
  children: ReactNode;
  reload?: () => void;
}) {
  const storeRef = useRef<UpdateCoordinatorStore | null>(null);
  if (!storeRef.current) {
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

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type {
  PosLocalStorageRuntime,
  PosLocalStorageRuntimeSnapshot,
} from "./posLocalStorageRuntime";

interface PosLocalStorageRuntimeContextValue<TStore> {
  runtime: PosLocalStorageRuntime<TStore>;
  snapshot: PosLocalStorageRuntimeSnapshot<TStore>;
}

const PosLocalStorageRuntimeContext = createContext<
  PosLocalStorageRuntimeContextValue<unknown> | undefined
>(undefined);

export function PosLocalStorageRuntimeProvider<TStore>({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: PosLocalStorageRuntime<TStore>;
}) {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  useEffect(() => {
    void runtime.start().catch(() => undefined);
    return () => {
      void runtime.dispose();
    };
  }, [runtime]);

  const value = useMemo(() => ({ runtime, snapshot }), [runtime, snapshot]);

  return (
    <PosLocalStorageRuntimeContext.Provider value={value}>
      {children}
    </PosLocalStorageRuntimeContext.Provider>
  );
}

export function usePosLocalStorageRuntime<
  TStore = unknown,
>(): PosLocalStorageRuntimeContextValue<TStore> {
  const value = useContext(PosLocalStorageRuntimeContext);
  if (!value) {
    throw new Error(
      "usePosLocalStorageRuntime must be used within PosLocalStorageRuntimeProvider.",
    );
  }
  return value as PosLocalStorageRuntimeContextValue<TStore>;
}

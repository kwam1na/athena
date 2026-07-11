import { useCallback, useEffect, useMemo, useState } from "react";

import type { Id } from "../../convex/_generated/dataModel";
import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";
import { getDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import { createExpenseLocalCommandGateway } from "@/lib/pos/infrastructure/local/expenseLocalCommandGateway";
import { usePosLocalSyncRuntimeStatus } from "@/lib/pos/infrastructure/local/usePosLocalSyncRuntime";

let sharedExpenseLocalStore: PosLocalStorePort | null = null;
const expenseLocalEventListeners = new Set<() => void>();

function getExpenseLocalStore() {
  sharedExpenseLocalStore ??= getDefaultPosLocalStore();
  return sharedExpenseLocalStore;
}

function notifyExpenseLocalEventAppended() {
  for (const listener of expenseLocalEventListeners) {
    listener();
  }
}

function createLocalId(kind: string) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${suffix}`;
}

export function useExpenseLocalRuntime(input: {
  staffProfileId?: Id<"staffProfile"> | null;
  storeId?: Id<"store"> | null;
  syncEnabled?: boolean;
  terminalId?: Id<"posTerminal"> | null;
}) {
  const [eventAppendToken, setEventAppendToken] = useState(0);
  const localStore = useMemo(() => getExpenseLocalStore(), []);
  const storeFactory = useCallback(() => localStore, [localStore]);

  const noteEventAppended = useCallback(() => {
    setEventAppendToken((current) => current + 1);
  }, []);

  useEffect(() => {
    expenseLocalEventListeners.add(noteEventAppended);
    return () => {
      expenseLocalEventListeners.delete(noteEventAppended);
    };
  }, [noteEventAppended]);

  const expenseLocalGateway = useMemo(
    () =>
      createExpenseLocalCommandGateway({
        store: localStore,
        createLocalId,
        onEventAppended: notifyExpenseLocalEventAppended,
      }),
    [localStore],
  );
  const syncEnabled = input.syncEnabled !== false;
  const syncRuntime = usePosLocalSyncRuntimeStatus({
    drainOnAppend: syncEnabled,
    eventAppendToken,
    mode: "status-only",
    onLocalEventsChanged: syncEnabled
      ? notifyExpenseLocalEventAppended
      : undefined,
    source: "sync-runtime",
    staffProfileId: syncEnabled ? input.staffProfileId : null,
    storeFactory,
    storeId: syncEnabled ? input.storeId : undefined,
    terminalId: syncEnabled ? input.terminalId : undefined,
  });

  return {
    expenseLocalGateway,
    eventAppendToken,
    localStore,
    noteEventAppended,
    syncRuntime,
  };
}

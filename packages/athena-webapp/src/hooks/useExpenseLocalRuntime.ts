import { useCallback, useMemo, useState } from "react";

import type { Id } from "../../convex/_generated/dataModel";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
} from "@/lib/pos/infrastructure/local/posLocalStore";
import { createExpenseLocalCommandGateway } from "@/lib/pos/infrastructure/local/expenseLocalCommandGateway";
import { usePosLocalSyncRuntimeStatus } from "@/lib/pos/infrastructure/local/usePosLocalSyncRuntime";

type ExpenseLocalStore = ReturnType<typeof createPosLocalStore>;

let sharedExpenseLocalStore: ExpenseLocalStore | null = null;

function getExpenseLocalStore() {
  sharedExpenseLocalStore ??= createPosLocalStore({
    adapter: createIndexedDbPosLocalStorageAdapter(),
  });
  return sharedExpenseLocalStore;
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
  terminalId?: Id<"posTerminal"> | null;
}) {
  const [eventAppendToken, setEventAppendToken] = useState(0);
  const localStore = useMemo(() => getExpenseLocalStore(), []);
  const storeFactory = useCallback(() => localStore, [localStore]);

  const noteEventAppended = useCallback(() => {
    setEventAppendToken((current) => current + 1);
  }, []);

  const expenseLocalGateway = useMemo(
    () =>
      createExpenseLocalCommandGateway({
        store: localStore,
        createLocalId,
        onEventAppended: noteEventAppended,
      }),
    [localStore, noteEventAppended],
  );
  const syncRuntime = usePosLocalSyncRuntimeStatus({
    drainOnAppend: true,
    eventAppendToken,
    mode: "drain-enabled",
    source: "sync-runtime",
    staffProfileId: input.staffProfileId,
    storeFactory,
    storeId: input.storeId,
    terminalId: input.terminalId,
  });

  return {
    expenseLocalGateway,
    eventAppendToken,
    localStore,
    noteEventAppended,
    syncRuntime,
  };
}

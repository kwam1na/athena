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
  // The shared demo's restore epoch. `ingestLocalEvents` rejects demo uploads that omit
  // it (retryable `precondition_failed`), so without it expense batches retry forever and
  // never sync. Register plumbs the same value through — see useRegisterLocalRuntime.
  expectedDemoEpoch?: number;
  staffProfileId?: Id<"staffProfile"> | null;
  storeId?: Id<"store"> | null;
  syncEnabled?: boolean;
  terminalId?: Id<"posTerminal"> | null;
}) {
  // `eventAppendToken` is the sync runtime's *trigger* — it must be bumped only by real
  // local event appends, never by the runtime's own settle callback, or the runtime would
  // re-arm itself into an infinite drain loop. `localReadRefreshToken` carries the
  // settle-refresh signal instead, mirroring the register runtime's two-token split.
  const [eventAppendToken, setEventAppendToken] = useState(0);
  const [localReadRefreshToken, setLocalReadRefreshToken] = useState(0);
  const localStore = useMemo(() => getExpenseLocalStore(), []);
  const storeFactory = useCallback(() => localStore, [localStore]);

  const noteEventAppended = useCallback(() => {
    setEventAppendToken((current) => current + 1);
  }, []);
  const noteLocalReadRefresh = useCallback(() => {
    setLocalReadRefreshToken((current) => current + 1);
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
    expectedDemoEpoch: syncEnabled ? input.expectedDemoEpoch : undefined,
    mode: "status-only",
    // A background settle refreshes the local read model but is NOT a new append, so it
    // must not feed back into the sync trigger (`eventAppendToken`).
    onLocalEventsChanged: syncEnabled ? noteLocalReadRefresh : undefined,
    source: "sync-runtime",
    staffProfileId: syncEnabled ? input.staffProfileId : null,
    storeFactory,
    storeId: syncEnabled ? input.storeId : undefined,
    terminalId: syncEnabled ? input.terminalId : undefined,
  });

  return {
    expenseLocalGateway,
    // Consumers watch this as a single "local state changed" signal: it advances on both
    // real appends and background settles. Both counters only increment, so the sum
    // strictly increases whenever either fires. The sync runtime is fed the raw
    // append-only token above, so exposing the combined value here cannot re-arm it.
    eventAppendToken: eventAppendToken + localReadRefreshToken,
    localStore,
    noteEventAppended,
    syncRuntime,
  };
}

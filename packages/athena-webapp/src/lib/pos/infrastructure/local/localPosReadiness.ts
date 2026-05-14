import { useEffect, useMemo, useState } from "react";

import type { PosLocalEntryContext } from "./localPosEntryContext";
import { readProjectedLocalRegisterModel } from "./localRegisterReader";
import type { PosLocalRegisterReadModel } from "./registerReadModel";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalStoreDayReadiness,
  type PosLocalStoreResult,
} from "./posLocalStore";

export type PosLocalDailyOpeningSnapshot = {
  status?: "blocked" | "needs_attention" | "ready" | "started";
};

export type PosLocalDailyCloseSnapshot = {
  existingClose?: {
    lifecycleStatus?: "active" | "reopened" | "superseded";
  } | null;
  status?: "blocked" | "needs_review" | "carry_forward" | "ready" | "completed";
};

export type LocalPosReadiness =
  | { status: "loading" }
  | {
      status: "ready";
      source: "live" | "local_readiness" | "local_register";
      storeDayStatus: "started" | "reopened";
    }
  | {
      status: "blocked";
      reason:
        | "not_started"
        | "closed"
        | "local_closeout"
        | "missing_seed"
        | "waiting_for_close_snapshot"
        | "unknown"
        | "local_store_unavailable";
      message: string;
    };

export type PosLocalReadinessStore = {
  readStoreDayReadiness(input: {
    storeId: string;
    operatingDate: string;
  }): Promise<PosLocalStoreResult<PosLocalStoreDayReadiness | null>>;
  writeStoreDayReadiness?(
    readiness: PosLocalStoreDayReadiness,
  ): Promise<PosLocalStoreResult<PosLocalStoreDayReadiness>>;
} & Parameters<typeof readProjectedLocalRegisterModel>[0]["store"];

export function localReadinessRecordFromSnapshots(input: {
  closeSnapshot?: PosLocalDailyCloseSnapshot;
  clock?: () => number;
  openingSnapshot?: PosLocalDailyOpeningSnapshot;
  operatingDate: string;
  storeId: string;
}): PosLocalStoreDayReadiness | null {
  const updatedAt = (input.clock ?? Date.now)();

  if (input.closeSnapshot?.status === "completed") {
    const closeLifecycleStatus =
      input.closeSnapshot.existingClose?.lifecycleStatus;

    return {
      storeId: input.storeId,
      operatingDate: input.operatingDate,
      status: closeLifecycleStatus === "reopened" ? "reopened" : "closed",
      source: "daily_close",
      updatedAt,
      ...(closeLifecycleStatus ? { closeLifecycleStatus } : {}),
    };
  }

  if (
    input.openingSnapshot?.status === "started" &&
    !input.closeSnapshot
  ) {
    return null;
  }

  if (input.openingSnapshot?.status) {
    return {
      storeId: input.storeId,
      operatingDate: input.operatingDate,
      status:
        input.openingSnapshot.status === "started"
          ? "started"
          : "not_started",
      source: "daily_opening",
      updatedAt,
    };
  }

  return null;
}

export function evaluateLocalPosReadiness(input: {
  closeSnapshot?: PosLocalDailyCloseSnapshot;
  entryContext: PosLocalEntryContext;
  localReadiness?: PosLocalStoreDayReadiness | null;
  openingSnapshot?: PosLocalDailyOpeningSnapshot;
  operatingDate: string;
  registerReadModel?: PosLocalRegisterReadModel | null;
}): LocalPosReadiness {
  if (input.entryContext.status === "loading") {
    return { status: "loading" };
  }

  if (input.entryContext.status !== "ready") {
    return blocked(
      input.entryContext.status === "unsupported_schema"
        ? "local_store_unavailable"
        : "missing_seed",
      input.entryContext.status === "unsupported_schema"
        ? "POS setup needs attention. Refresh this terminal setup before starting sales."
        : "POS setup required. Connect this terminal before starting sales.",
    );
  }

  const localReadiness = localReadinessMatchesInput({
    entryContext: input.entryContext,
    localReadiness: input.localReadiness,
    operatingDate: input.operatingDate,
  })
    ? input.localReadiness
    : null;

  if (
    input.closeSnapshot?.status === "completed" &&
    input.closeSnapshot.existingClose?.lifecycleStatus !== "reopened"
  ) {
    return blocked(
      "closed",
      "Store day closed. Reopen the end of day review before entering POS.",
    );
  }

  if (
    input.openingSnapshot?.status &&
    input.openingSnapshot.status !== "started"
  ) {
    return blocked(
      "not_started",
      "Store day not started. Complete Opening Handoff before starting sales.",
    );
  }

  if (input.registerReadModel?.closeoutState?.status === "closed_locally") {
    return blocked(
      "local_closeout",
      "Drawer closeout started. Reopen the drawer before starting sales.",
    );
  }

  if (input.openingSnapshot?.status === "started" && !input.closeSnapshot) {
    if (localReadiness?.status === "closed") {
      return evaluateLocalPosReadiness({
        entryContext: input.entryContext,
        localReadiness,
        operatingDate: input.operatingDate,
        registerReadModel: input.registerReadModel,
      });
    }

    return {
      status: "loading",
    };
  }

  if (input.openingSnapshot?.status === "started") {
    return {
      status: "ready",
      source: "live",
      storeDayStatus:
        input.closeSnapshot?.existingClose?.lifecycleStatus === "reopened"
          ? "reopened"
          : "started",
    };
  }

  if (
    localReadiness?.status === "started" ||
    localReadiness?.status === "reopened"
  ) {
    return {
      status: "ready",
      source: "local_readiness",
      storeDayStatus: localReadiness.status,
    };
  }

  if (localReadiness?.status === "closed") {
    return blocked(
      "closed",
      "Store day closed. Reopen the end of day review before entering POS.",
    );
  }

  if (localReadiness?.status === "not_started") {
    return blocked(
      "not_started",
      "Store day not started. Complete Opening Handoff before starting sales.",
    );
  }

  if (input.registerReadModel?.canSell) {
    return {
      status: "ready",
      source: "local_register",
      storeDayStatus: "started",
    };
  }

  return blocked(
    "unknown",
    "Store day status unavailable. Connect this terminal before starting sales.",
  );
}

function localReadinessMatchesInput(input: {
  entryContext: PosLocalEntryContext;
  localReadiness?: PosLocalStoreDayReadiness | null;
  operatingDate: string;
}) {
  return (
    input.entryContext.status === "ready" &&
    input.localReadiness?.storeId === input.entryContext.storeId &&
    input.localReadiness.operatingDate === input.operatingDate
  );
}

export async function readLocalPosReadiness(input: {
  entryContext: PosLocalEntryContext;
  operatingDate: string;
  store: PosLocalReadinessStore;
}): Promise<
  PosLocalStoreResult<{
    localReadiness: PosLocalStoreDayReadiness | null;
    registerReadModel: PosLocalRegisterReadModel;
  }>
> {
  if (input.entryContext.status !== "ready") {
    return {
      ok: false,
      error: {
        code: "write_failed",
        message: "POS local entry context is not ready.",
      },
    };
  }

  const [localReadiness, registerReadModel] = await Promise.all([
    input.store.readStoreDayReadiness({
      storeId: input.entryContext.storeId,
      operatingDate: input.operatingDate,
    }),
    readProjectedLocalRegisterModel({
      store: input.store,
      storeId: input.entryContext.storeId,
      terminalId: input.entryContext.terminalSeed?.terminalId,
    }),
  ]);

  if (!localReadiness.ok) return localReadiness;
  if (!registerReadModel.ok) return registerReadModel;

  return {
    ok: true,
    value: {
      localReadiness: localReadiness.value,
      registerReadModel: registerReadModel.value,
    },
  };
}

export async function refreshLocalPosReadinessFromSnapshots(input: {
  closeSnapshot?: PosLocalDailyCloseSnapshot;
  clock?: () => number;
  entryContext: PosLocalEntryContext;
  openingSnapshot?: PosLocalDailyOpeningSnapshot;
  operatingDate: string;
  store: Pick<PosLocalReadinessStore, "writeStoreDayReadiness">;
}): Promise<PosLocalStoreResult<PosLocalStoreDayReadiness | null>> {
  if (input.entryContext.status !== "ready") {
    return { ok: true, value: null };
  }

  const readiness = localReadinessRecordFromSnapshots({
    closeSnapshot: input.closeSnapshot,
    clock: input.clock,
    openingSnapshot: input.openingSnapshot,
    operatingDate: input.operatingDate,
    storeId: input.entryContext.storeId,
  });

  if (!readiness || !input.store.writeStoreDayReadiness) {
    return { ok: true, value: null };
  }

  return input.store.writeStoreDayReadiness(readiness);
}

export function useLocalPosReadiness(input: {
  closeSnapshot?: PosLocalDailyCloseSnapshot;
  entryContext: PosLocalEntryContext;
  openingSnapshot?: PosLocalDailyOpeningSnapshot;
  operatingDate: string;
}) {
  const activeStateKey = useMemo(
    () => readinessStateKey(input.entryContext, input.operatingDate),
    [input.entryContext, input.operatingDate],
  );
  const closeLifecycleStatus =
    input.closeSnapshot?.existingClose?.lifecycleStatus ?? null;
  const closeStatus = input.closeSnapshot?.status ?? null;
  const openingStatus = input.openingSnapshot?.status ?? null;
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [localState, setLocalState] = useState<
    | { status: "loading" }
    | {
        status: "ready";
        localReadiness: PosLocalStoreDayReadiness | null;
        registerReadModel: PosLocalRegisterReadModel;
        stateKey: PosLocalReadinessStateKey;
      }
    | { status: "failed" }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    if (input.entryContext.status !== "ready") {
      setLocalState({ status: "failed" });
      return;
    }

    if (typeof indexedDB === "undefined") {
      setLocalState({ status: "failed" });
      return;
    }

    const stateKey = readinessStateKey(input.entryContext, input.operatingDate);
    setLocalState({ status: "loading" });

    void (async () => {
      const store = createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      });
      const result = await readLocalPosReadiness({
        entryContext: input.entryContext,
        operatingDate: input.operatingDate,
        store,
      });

      if (cancelled) return;

      if (result.ok) {
        setLocalState({
          status: "ready",
          localReadiness: result.value.localReadiness,
          registerReadModel: result.value.registerReadModel,
          stateKey,
        });
        return;
      }

      setLocalState({ status: "failed" });
    })();

    return () => {
      cancelled = true;
    };
  }, [input.entryContext, input.operatingDate, refreshVersion]);

  useEffect(() => {
    if (input.entryContext.status !== "ready") return;
    if (typeof indexedDB === "undefined") return;

    let cancelled = false;

    void (async () => {
      if (input.entryContext.status !== "ready") return;

      const result = await refreshLocalPosReadinessFromSnapshots({
        closeSnapshot:
          closeStatus === null
            ? undefined
            : {
                status: closeStatus,
                ...(closeLifecycleStatus
                  ? { existingClose: { lifecycleStatus: closeLifecycleStatus } }
                  : {}),
              },
        entryContext: input.entryContext,
        openingSnapshot:
          openingStatus === null ? undefined : { status: openingStatus },
        operatingDate: input.operatingDate,
        store: createPosLocalStore({
          adapter: createIndexedDbPosLocalStorageAdapter(),
        }),
      });

      if (!cancelled && result.ok && result.value) {
        setRefreshVersion((version) => version + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    closeLifecycleStatus,
    closeStatus,
    input.entryContext,
    openingStatus,
    input.operatingDate,
  ]);

  return useMemo(() => {
    if (input.entryContext.status !== "ready") {
      return evaluateLocalPosReadiness({
        closeSnapshot: input.closeSnapshot,
        entryContext: input.entryContext,
        openingSnapshot: input.openingSnapshot,
        operatingDate: input.operatingDate,
      });
    }

    if (localState.status === "loading") {
      return { status: "loading" as const };
    }

    if (localState.status === "failed") {
      return evaluateLocalPosReadiness({
        closeSnapshot: input.closeSnapshot,
        entryContext: input.entryContext,
        openingSnapshot: input.openingSnapshot,
        operatingDate: input.operatingDate,
      });
    }

    if (!readinessStateKeysEqual(localState.stateKey, activeStateKey)) {
      return { status: "loading" as const };
    }

    return evaluateLocalPosReadiness({
      closeSnapshot: input.closeSnapshot,
      entryContext: input.entryContext,
      localReadiness: localState.localReadiness,
      openingSnapshot: input.openingSnapshot,
      operatingDate: input.operatingDate,
      registerReadModel: localState.registerReadModel,
    });
  }, [
    activeStateKey,
    input.closeSnapshot,
    input.entryContext,
    input.openingSnapshot,
    input.operatingDate,
    localState,
  ]);
}

type PosLocalReadinessStateKey =
  | {
      status: "ready";
      operatingDate: string;
      storeId: string;
      terminalId: string | null;
    }
  | { status: "not_ready" };

function readinessStateKey(
  entryContext: PosLocalEntryContext,
  operatingDate: string,
): PosLocalReadinessStateKey {
  if (entryContext.status !== "ready") return { status: "not_ready" };

  return {
    status: "ready",
    operatingDate,
    storeId: entryContext.storeId,
    terminalId: entryContext.terminalSeed?.terminalId ?? null,
  };
}

function readinessStateKeysEqual(
  left: PosLocalReadinessStateKey,
  right: PosLocalReadinessStateKey,
) {
  if (left.status !== right.status) return false;
  if (left.status !== "ready" || right.status !== "ready") return true;

  return (
    left.storeId === right.storeId &&
    left.operatingDate === right.operatingDate &&
    left.terminalId === right.terminalId
  );
}

function blocked(
  reason: Extract<LocalPosReadiness, { status: "blocked" }>["reason"],
  message: string,
): LocalPosReadiness {
  return {
    status: "blocked",
    reason,
    message,
  };
}

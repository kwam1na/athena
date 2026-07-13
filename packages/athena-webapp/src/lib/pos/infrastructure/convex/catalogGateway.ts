import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  PosBarcodeLookupInput,
  PosCatalogItemDto,
  PosProductIdLookupInput,
  PosProductSearchInput,
  PosRegisterCatalogAvailabilityInput,
  PosRegisterCatalogAvailabilityRowDto,
  PosRegisterCatalogInput,
  PosRegisterCatalogRowDto,
  PosServiceCatalogRowDto,
} from "@/lib/pos/application/dto";
import type { PosCatalogReader } from "@/lib/pos/application/ports";
import type { PosLocalRegisterCatalogSnapshot } from "@/lib/pos/application/posLocalStoreTypes";
import { getDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import {
  clearRegisterCatalogRuntimeSelection,
  getRegisterCatalogRuntimeOwnerId,
  setRegisterCatalogRuntimeSelection,
} from "@/lib/pos/infrastructure/local/registerCatalogPinRuntime";
import {
  type RegisterAvailabilitySnapshotState,
  readRegisterAvailabilitySnapshotState,
} from "@/lib/pos/infrastructure/local/registerAvailabilitySnapshot";
import {
  extractBarcodeFromInput,
  isValidConvexId,
} from "@/lib/pos/barcodeUtils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type { CommandResult } from "~/shared/commandResult";
import { isPosCatalogVisible } from "~/shared/posCatalogVisibility";

const REGISTER_CATALOG_AVAILABILITY_LIMIT = 50;
const REGISTER_AVAILABILITY_SNAPSHOT_WRITE_RETRY_DELAY_MS = 250;
const REGISTER_CATALOG_REFRESH_REUSE_WINDOW_MS = 5_000;
const LOCAL_PENDING_SKU_ID_PREFIX = "local-pending-sku-";

type CatalogRefreshClass = "full-availability" | "metadata";

type CatalogRefreshEntry = {
  generation: number;
  inFlight?: {
    refreshKey: string;
    promise: Promise<CatalogRefreshResult<unknown>>;
  };
  lastSuccess?: {
    completedAt: number;
    refreshKey: string;
    value: unknown;
  };
  persistenceTail: Promise<void>;
};

type CatalogRefreshResult<Value> =
  | { status: "completed"; value: Value }
  | { status: "superseded" };

const catalogRefreshEntries = new Map<string, CatalogRefreshEntry>();

export function __resetCatalogRefreshCoordinatorForTests() {
  catalogRefreshEntries.clear();
}

function catalogRefreshEntryKey(
  storeId: string,
  refreshClass: CatalogRefreshClass,
) {
  return `${refreshClass}:${storeId}`;
}

function coordinateCatalogRefresh<Rows, Persisted>({
  storeId,
  refreshClass,
  refreshKey,
  load,
  persist,
}: {
  storeId: string;
  refreshClass: CatalogRefreshClass;
  refreshKey: string;
  load: () => Promise<Rows>;
  persist: (rows: Rows) => Promise<Persisted>;
}): Promise<CatalogRefreshResult<Persisted>> {
  const entryKey = catalogRefreshEntryKey(storeId, refreshClass);
  const entry = catalogRefreshEntries.get(entryKey) ?? {
    generation: 0,
    persistenceTail: Promise.resolve(),
  };
  catalogRefreshEntries.set(entryKey, entry);

  if (
    entry.lastSuccess?.refreshKey === refreshKey &&
    Date.now() - entry.lastSuccess.completedAt <=
      REGISTER_CATALOG_REFRESH_REUSE_WINDOW_MS
  ) {
    return Promise.resolve({
      status: "completed",
      value: entry.lastSuccess.value as Persisted,
    });
  }

  if (entry.inFlight?.refreshKey === refreshKey) {
    return entry.inFlight.promise as Promise<CatalogRefreshResult<Persisted>>;
  }

  const generation = entry.generation + 1;
  entry.generation = generation;
  const promise = (async (): Promise<CatalogRefreshResult<Persisted>> => {
    const rows = await load();
    let persisted: Persisted | undefined;
    let persistenceError: unknown;

    const persistence = entry.persistenceTail.then(async () => {
      if (entry.generation !== generation) return;
      try {
        persisted = await persist(rows);
      } catch (error) {
        persistenceError = error;
      }
    });
    entry.persistenceTail = persistence.then(
      () => undefined,
      () => undefined,
    );
    await persistence;

    if (entry.generation !== generation) {
      return { status: "superseded" };
    }
    if (persistenceError !== undefined) throw persistenceError;
    if (persisted === undefined) {
      throw new Error("Catalog refresh persistence returned no result.");
    }

    entry.lastSuccess = {
      completedAt: Date.now(),
      refreshKey,
      value: persisted,
    };
    return { status: "completed", value: persisted };
  })();

  entry.inFlight = {
    refreshKey,
    promise: promise as Promise<CatalogRefreshResult<unknown>>,
  };
  void promise.finally(() => {
    if (entry.inFlight?.promise === promise) {
      entry.inFlight = undefined;
    }
  }).catch(() => undefined);

  return promise;
}

const REGISTER_CATALOG_REFRESH_RETRY_BASE_DELAY_MS = 1_000;
const REGISTER_CATALOG_REFRESH_RETRY_MAX_DELAY_MS = 8_000;
const REGISTER_CATALOG_REFRESH_RETRY_QUIET_DELAY_MS = 60_000;
const REGISTER_CATALOG_REFRESH_RAPID_RETRY_LIMIT = 4;
const REGISTER_CATALOG_PIN_HEARTBEAT_MS = 5 * 60 * 1_000;
const REGISTER_CATALOG_MIN_REFRESH_INTERVAL_MS = 5_000;

export function getRegisterCatalogRefreshRetryDelay(attempt: number) {
  return attempt >= REGISTER_CATALOG_REFRESH_RAPID_RETRY_LIMIT
    ? REGISTER_CATALOG_REFRESH_RETRY_QUIET_DELAY_MS
    : Math.min(
        REGISTER_CATALOG_REFRESH_RETRY_BASE_DELAY_MS * 2 ** attempt,
        REGISTER_CATALOG_REFRESH_RETRY_MAX_DELAY_MS,
      );
}

type RegisterCatalogRevisionQuery = FunctionReference<
  "query",
  "public",
  { storeId: Id<"store"> },
  { status: "authorization-paused" } | { revision: number; status: "ready" }
>;

type RegisterCatalogRevisionedSnapshotQuery = FunctionReference<
  "query",
  "public",
  { storeId: Id<"store"> },
  { revision: number; rows: PosRegisterCatalogRowDto[] }
>;

const registerCatalogApi = api as unknown as {
  pos: {
    public: {
      catalog: {
        getRegisterCatalogRevision: RegisterCatalogRevisionQuery;
        listRegisterCatalogSnapshotWithRevision: RegisterCatalogRevisionedSnapshotQuery;
      };
    };
  };
};

type RegisterServiceCatalogSnapshotQuery = FunctionReference<
  "query",
  "public",
  { storeId: Id<"store"> },
  PosServiceCatalogRowDto[]
>;

const serviceCatalogApi = api as unknown as {
  serviceOps: {
    catalog: {
      listPosServiceCatalogSnapshot: RegisterServiceCatalogSnapshotQuery;
    };
  };
};

type RegisterCatalogAvailabilityGatewayState =
  | {
      rows: PosRegisterCatalogAvailabilityRowDto[];
      source: "live" | "local";
      status: "ready";
    }
  | {
      refreshedAt?: number;
      rows?: undefined;
      source: "local";
      status: "stale";
    }
  | {
      rows?: undefined;
      source: "none";
      status: "loading" | "missing";
    }
  | {
      error?: RegisterAvailabilitySnapshotState extends infer State
        ? State extends { status: "local-store-failure"; error: infer Error }
          ? Error
          : never
        : never;
      rows?: undefined;
      source: "none";
      status: "local-store-failure";
    };

type RegisterCatalogMetadataGatewayState =
  | {
      appliedRevision?: number | "legacy";
      catalogRefreshStatus?: RegisterCatalogRefreshStatus;
      observedRevision?: number;
      refreshedAt: number;
      rows: PosRegisterCatalogRowDto[];
      source: "local" | "refresh";
      status: "ready";
    }
  | {
      appliedRevision?: number | "legacy";
      catalogRefreshStatus?: RegisterCatalogRefreshStatus;
      observedRevision?: number;
      refreshedAt?: number;
      rows?: PosRegisterCatalogRowDto[];
      source: "local" | "none";
      status: "refreshing";
    }
  | {
      appliedRevision?: number | "legacy";
      catalogRefreshStatus?: RegisterCatalogRefreshStatus;
      observedRevision?: number;
      rows?: undefined;
      source: "none";
      status: "loading" | "missing";
    }
  | {
      appliedRevision?: number | "legacy";
      catalogRefreshStatus?: RegisterCatalogRefreshStatus;
      observedRevision?: number;
      error: unknown;
      rows?: undefined;
      source: "none";
      status: "local-store-failure";
    }
  | {
      appliedRevision?: number | "legacy";
      catalogRefreshStatus?: RegisterCatalogRefreshStatus;
      observedRevision?: number;
      error: unknown;
      refreshedAt?: number;
      rows?: PosRegisterCatalogRowDto[];
      source: "local" | "none";
      status: "refresh-failed";
    };

export type RegisterCatalogRefreshStatus =
  | "current"
  | "waiting-busy"
  | "waiting-offline"
  | "refreshing"
  | "retry-delayed"
  | "authorization-paused";

type ProductByIdResult = {
  _id: Id<"product">;
  name?: string;
  description?: string;
  areProcessingFeesAbsorbed?: boolean;
  skus?: Array<{
    _id: Id<"productSku">;
    sku?: string;
    barcode?: string;
    netPrice?: number;
    price: number;
    productCategory?: string;
    quantityAvailable: number;
    images?: string[];
    isVisible?: boolean;
    posVisible?: boolean;
    size?: string;
    length?: number | null;
    colorName?: string;
  }>;
} | null;

function mapProductByIdResult(
  productData: ProductByIdResult,
): PosCatalogItemDto[] {
  if (!productData?.skus) {
    return [];
  }

  const availableSkus = productData.skus.filter((sku) =>
    isPosCatalogVisible(sku),
  );

  return availableSkus.map((sku) => ({
    id: sku._id,
    name: productData.name || "",
    sku: sku.sku || "",
    barcode: sku.barcode || "",
    price: sku.netPrice || sku.price,
    category: sku.productCategory || "",
    description: productData.description || "",
    inStock: sku.quantityAvailable > 0,
    quantityAvailable: sku.quantityAvailable,
    image: sku.images?.[0] || null,
    size: sku.size || "",
    length: sku.length || null,
    color: sku.colorName || "",
    productId: productData._id,
    skuId: sku._id,
    areProcessingFeesAbsorbed: productData.areProcessingFeesAbsorbed || false,
    availabilityPolicy: "trusted_inventory",
  }));
}

function useBrowserOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return isOnline;
}

function isAuthorizationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unauth|forbidden|permission|access denied/i.test(message);
}

export function useConvexRegisterCatalog(
  input: PosRegisterCatalogInput,
): PosRegisterCatalogRowDto[] | undefined {
  const state = useConvexRegisterCatalogState(input);

  return "rows" in state ? state.rows : undefined;
}

export function useConvexRegisterCatalogState(
  input: PosRegisterCatalogInput,
): RegisterCatalogMetadataGatewayState {
  const convex = useConvex();
  const refreshKey = String(input.metadataRefreshKey ?? "");
  const shouldRefresh = Boolean(input.refreshMetadataSnapshot);
  const registerRefresh = input.registerRefresh;
  const isRegisterRefresh = Boolean(registerRefresh);
  const registerTerminalId = registerRefresh?.terminalId;
  const generatedRuntimeOwnerIdRef = useRef<string | undefined>(undefined);
  if (registerRefresh && !generatedRuntimeOwnerIdRef.current) {
    generatedRuntimeOwnerIdRef.current = getRegisterCatalogRuntimeOwnerId();
  }
  const registerRuntimeOwnerId =
    registerRefresh?.ownerId ?? generatedRuntimeOwnerIdRef.current;
  const isOperationallyIdle = registerRefresh?.isOperationallyIdle ?? false;
  const storeId = input.storeId;
  const isOnline = useBrowserOnlineStatus();
  const revisionSignal = useQuery(
    registerCatalogApi.pos.public.catalog.getRegisterCatalogRevision,
    storeId && isRegisterRefresh ? { storeId } : "skip",
  ) as
    | { status: "authorization-paused" }
    | { revision: number; status: "ready" }
    | undefined;
  const observedRevision =
    revisionSignal?.status === "ready" ? revisionSignal.revision : undefined;
  const revisionAuthorizationPaused =
    revisionSignal?.status === "authorization-paused";
  const appliedRevisionRef = useRef<number | "legacy" | null>(null);
  const authorizationPausedScopeRef = useRef<string | null>(null);
  const revisionAuthorizationWasPausedRef = useRef(false);
  const hydratedScopeRef = useRef<string | null>(null);
  const inFlightAttemptRef = useRef<{ scopeKey: string } | null>(null);
  const lastRefreshAtRef = useRef(0);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryScopeRef = useRef<string | null>(null);
  const previousOperationalIdleRef = useRef<boolean | null>(null);
  const [reconcileTick, setReconcileTick] = useState(0);
  const scopeKey = `${String(storeId ?? "")}:${registerTerminalId ?? ""}:${registerRefresh?.authScopeKey ?? ""}:${registerRuntimeOwnerId ?? ""}`;
  const currentScopeRef = useRef(scopeKey);
  const idleRef = useRef(isOperationallyIdle);
  const readIdleNowRef = useRef(registerRefresh?.isOperationallyIdleNow);
  currentScopeRef.current = scopeKey;
  idleRef.current = isOperationallyIdle;
  readIdleNowRef.current = registerRefresh?.isOperationallyIdleNow;
  const [state, setState] = useState<RegisterCatalogMetadataGatewayState>(() =>
    shouldRefresh
      ? { rows: undefined, source: "none", status: "refreshing" }
      : { source: "none", status: "loading" },
  );

  useEffect(() => {
    if (retryScopeRef.current === scopeKey) return;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryScopeRef.current = scopeKey;
    retryAttemptRef.current = 0;
    lastRefreshAtRef.current = 0;
    authorizationPausedScopeRef.current = null;
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    setState((current) => {
      if (shouldRefresh) {
        return {
          refreshedAt:
            "refreshedAt" in current ? current.refreshedAt : undefined,
          rows: "rows" in current ? current.rows : undefined,
          source: "rows" in current && current.rows ? "local" : "none",
          status: "refreshing",
        };
      }

      return { source: "none", status: "loading" };
    });

    if (!storeId) {
      setState({ source: "none", status: "missing" });
      return;
    }

    void (async () => {
      const result =
        isRegisterRefresh && registerTerminalId
          ? await getDefaultPosLocalStore().readRegisterCatalogSelection({
              ownerId: registerRuntimeOwnerId,
              storeId,
              terminalId: registerTerminalId,
            })
          : await getDefaultPosLocalStore().readRegisterCatalogSnapshot({
              storeId,
            });

      if (cancelled) return;
      if (result.ok && result.value) {
        const snapshot = result.value;
        if ("revision" in snapshot) {
          appliedRevisionRef.current = snapshot.revision;
          hydratedScopeRef.current = scopeKey;
          if (registerTerminalId) {
            setRegisterCatalogRuntimeSelection({
              revision: snapshot.revision,
              rows: snapshot.rows,
              storeId,
              terminalId: registerTerminalId,
            });
          }
          setState({
            appliedRevision: snapshot.revision,
            catalogRefreshStatus: "current",
            refreshedAt: snapshot.persistedAt,
            rows: snapshot.rows,
            source: "local",
            status: "ready",
          });
          setReconcileTick((current) => current + 1);
          return;
        }
        if (shouldRefresh) {
          setState((current) =>
            current.status === "ready" && current.source === "refresh"
              ? current
              : {
                  refreshedAt: snapshot.refreshedAt,
                  rows: snapshot.rows,
                  source: "local",
                  status: "refreshing",
                },
          );
        } else {
          setState({
            refreshedAt: snapshot.refreshedAt,
            rows: snapshot.rows,
            source: "local",
            status: "ready",
          });
        }
        return;
      }

      if (result.ok) {
        if (isRegisterRefresh) {
          appliedRevisionRef.current = null;
          hydratedScopeRef.current = scopeKey;
          setState({
            catalogRefreshStatus: "current",
            source: "none",
            status: "missing",
          });
          setReconcileTick((current) => current + 1);
          return;
        }
        if (shouldRefresh) {
          setState((current) =>
            current.status === "ready" && current.source === "refresh"
              ? current
              : { rows: undefined, source: "none", status: "refreshing" },
          );
        } else {
          setState({ source: "none", status: "missing" });
        }
        return;
      }

      if (shouldRefresh) {
        setState((current) =>
          current.status === "ready" && current.source === "refresh"
            ? current
            : {
                error: result.error,
                refreshedAt:
                  "refreshedAt" in current ? current.refreshedAt : undefined,
                rows: "rows" in current ? current.rows : undefined,
                source: "rows" in current && current.rows ? "local" : "none",
                status: "refresh-failed",
              },
        );
        return;
      }

      setState({
        error: result.error,
        source: "none",
        status: "local-store-failure",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isRegisterRefresh,
    registerRuntimeOwnerId,
    registerTerminalId,
    scopeKey,
    shouldRefresh,
    storeId,
  ]);

  useEffect(() => {
    if (
      !storeId ||
      !registerTerminalId ||
      !registerRuntimeOwnerId ||
      !isRegisterRefresh ||
      isOperationallyIdle
    ) {
      return;
    }

    const renewRegisterCatalogPinLease =
      getDefaultPosLocalStore().renewRegisterCatalogPinLease;
    if (!renewRegisterCatalogPinLease) return;
    const ownerId = registerRuntimeOwnerId;
    const activeStoreId = storeId;
    const terminalId = registerTerminalId;
    let cancelled = false;
    const renewLease = async () => {
      const result = await renewRegisterCatalogPinLease({
        ownerId,
        storeId: activeStoreId,
        terminalId,
      });
      if (cancelled || result.ok) return;
    };
    void renewLease();
    const interval = setInterval(() => void renewLease(), REGISTER_CATALOG_PIN_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    isOperationallyIdle,
    isRegisterRefresh,
    registerRuntimeOwnerId,
    registerTerminalId,
    storeId,
  ]);

  useEffect(() => {
    if (!storeId || !shouldRefresh || isRegisterRefresh) {
      return;
    }

    let cancelled = false;

    setState((current) => ({
      refreshedAt: "refreshedAt" in current ? current.refreshedAt : undefined,
      rows: "rows" in current ? current.rows : undefined,
      source: "rows" in current && current.rows ? "local" : "none",
      status: "refreshing",
    }));

    void (async () => {
      try {
        const refresh = await coordinateCatalogRefresh<
          PosRegisterCatalogRowDto[],
          PosLocalRegisterCatalogSnapshot
        >({
          refreshClass: "metadata",
          refreshKey,
          storeId,
          load: () =>
            convex.query(api.pos.public.catalog.listRegisterCatalogSnapshot, {
              storeId,
            }),
          persist: async (rows) => {
            const writeResult =
              await getDefaultPosLocalStore().writeRegisterCatalogSnapshot({
                storeId,
                rows,
              });
            if (!writeResult.ok) throw writeResult.error;
            return writeResult.value;
          },
        });

        if (cancelled) return;
        if (refresh.status === "superseded") {
          const latest =
            await getDefaultPosLocalStore().readRegisterCatalogSnapshot({
              storeId,
            });
          if (cancelled) return;
          if (latest.ok && latest.value) {
            setState({
              refreshedAt: latest.value.refreshedAt,
              rows: latest.value.rows,
              source: "local",
              status: "ready",
            });
          } else {
            setState((current) => ({
              error: latest.ok
                ? new Error("The newer catalog refresh was not persisted.")
                : latest.error,
              refreshedAt:
                "refreshedAt" in current ? current.refreshedAt : undefined,
              rows: "rows" in current ? current.rows : undefined,
              source: "rows" in current && current.rows ? "local" : "none",
              status: "refresh-failed",
            }));
          }
          return;
        }
        if (refresh.status === "completed") {
          setState({
            refreshedAt: refresh.value.refreshedAt,
            rows: refresh.value.rows,
            source: "refresh",
            status: "ready",
          });
          return;
        }
      } catch (error) {
        if (cancelled) return;

        setState((current) => ({
          error,
          refreshedAt:
            "refreshedAt" in current ? current.refreshedAt : undefined,
          rows: "rows" in current ? current.rows : undefined,
          source: "rows" in current && current.rows ? "local" : "none",
          status: "refresh-failed",
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [convex, isRegisterRefresh, refreshKey, shouldRefresh, storeId]);

  useEffect(() => {
    if (!storeId || !registerTerminalId || !isRegisterRefresh) return;

    if (!isOperationallyIdle) {
      previousOperationalIdleRef.current = false;
      return;
    }

    const isIdleNow = () => readIdleNowRef.current?.() ?? idleRef.current;
    if (!isIdleNow()) return;

    const priorIdle = previousOperationalIdleRef.current;
    previousOperationalIdleRef.current = true;

    if (priorIdle === true) return;

    let cancelled = false;
    void (async () => {
      const pinResult = await getDefaultPosLocalStore().readRegisterCatalogPin({
        ownerId: registerRuntimeOwnerId,
        storeId,
        terminalId: registerTerminalId,
      });
      if (cancelled || !isIdleNow() || !pinResult.ok || !pinResult.value) return;

      const releaseResult =
        await getDefaultPosLocalStore().releaseRegisterCatalogPin({
          ownerId: registerRuntimeOwnerId,
          storeId,
          terminalId: registerTerminalId,
        });
      if (cancelled || !isIdleNow() || !releaseResult.ok) return;

      const selectionResult =
        await getDefaultPosLocalStore().readRegisterCatalogSelection({
          ownerId: registerRuntimeOwnerId,
          storeId,
          terminalId: registerTerminalId,
        });
      if (
        cancelled ||
        !isIdleNow() ||
        !selectionResult.ok ||
        !selectionResult.value
      ) {
        return;
      }

      const version = selectionResult.value;
      appliedRevisionRef.current = version.revision;
      setRegisterCatalogRuntimeSelection({
        revision: version.revision,
        rows: version.rows,
        storeId,
        terminalId: registerTerminalId,
      });
      setState({
        appliedRevision: version.revision,
        catalogRefreshStatus: "current",
        observedRevision,
        refreshedAt: version.persistedAt,
        rows: version.rows,
        source: "local",
        status: "ready",
      });
      setReconcileTick((current) => current + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isOperationallyIdle,
    isRegisterRefresh,
    observedRevision,
    registerRuntimeOwnerId,
    registerTerminalId,
    storeId,
  ]);

  useEffect(() => {
    if (
      storeId &&
      isRegisterRefresh &&
      revisionAuthorizationPaused &&
      hydratedScopeRef.current === scopeKey
    ) {
      revisionAuthorizationWasPausedRef.current = true;
      authorizationPausedScopeRef.current = scopeKey;
      setState((current) => ({
        ...current,
        catalogRefreshStatus: "authorization-paused",
      }));
      return;
    }

    if (
      observedRevision !== undefined &&
      revisionAuthorizationWasPausedRef.current &&
      authorizationPausedScopeRef.current === scopeKey
    ) {
      revisionAuthorizationWasPausedRef.current = false;
      authorizationPausedScopeRef.current = null;
    }

    if (
      !storeId ||
      !registerRuntimeOwnerId ||
      !registerTerminalId ||
      !isRegisterRefresh ||
      observedRevision === undefined ||
      hydratedScopeRef.current !== scopeKey
    ) {
      return;
    }

    const activeOwnerId = registerRuntimeOwnerId;
    const activeTerminalId = registerTerminalId;

    const appliedRevision = appliedRevisionRef.current;
    const needsRefresh =
      appliedRevision === null ||
      appliedRevision === "legacy" ||
      observedRevision > appliedRevision;

    if (!needsRefresh) {
      setState((current) => ({
        ...current,
        appliedRevision: appliedRevision ?? undefined,
        catalogRefreshStatus: "current",
        observedRevision,
      }));
      return;
    }

    const isIdleNow = () => readIdleNowRef.current?.() ?? idleRef.current;

    if (!isIdleNow()) {
      setState((current) => ({
        ...current,
        appliedRevision: appliedRevision ?? undefined,
        catalogRefreshStatus: "waiting-busy",
        observedRevision,
      }));
      return;
    }

    if (!isOnline) {
      setState((current) => ({
        ...current,
        appliedRevision: appliedRevision ?? undefined,
        catalogRefreshStatus: "waiting-offline",
        observedRevision,
      }));
      return;
    }

    if (
      inFlightAttemptRef.current?.scopeKey === scopeKey ||
      retryTimerRef.current ||
      authorizationPausedScopeRef.current === scopeKey
    ) {
      return;
    }

    const elapsed = Date.now() - lastRefreshAtRef.current;
    if (
      lastRefreshAtRef.current > 0 &&
      elapsed < REGISTER_CATALOG_MIN_REFRESH_INTERVAL_MS
    ) {
      if (!retryTimerRef.current) {
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          setReconcileTick((current) => current + 1);
        }, REGISTER_CATALOG_MIN_REFRESH_INTERVAL_MS - elapsed);
      }
      setState((current) => ({
        ...current,
        appliedRevision: appliedRevision ?? undefined,
        catalogRefreshStatus: "refreshing",
        observedRevision,
      }));
      return;
    }

    const attemptScope = scopeKey;
    const attempt = { scopeKey: attemptScope };
    inFlightAttemptRef.current = attempt;
    const isAttemptCurrent = () =>
      currentScopeRef.current === attemptScope &&
      inFlightAttemptRef.current === attempt;
    setState((current) => ({
      ...current,
      appliedRevision: appliedRevision ?? undefined,
      catalogRefreshStatus: "refreshing",
      observedRevision,
    }));

    void (async () => {
      try {
        const envelope = await convex.query(
          registerCatalogApi.pos.public.catalog
            .listRegisterCatalogSnapshotWithRevision,
          { storeId },
        );
        if (!isAttemptCurrent()) return;

        if (!isIdleNow()) {
          setState((current) => ({
            ...current,
            catalogRefreshStatus: "waiting-busy",
            observedRevision,
          }));
          return;
        }

        const stageResult =
          await getDefaultPosLocalStore().stageRegisterCatalogVersion({
            revision: envelope.revision,
            rows: envelope.rows,
            storeId,
          });
        if (!isAttemptCurrent()) return;
        if (!stageResult.ok) throw stageResult.error;

        if (!isIdleNow()) {
          setState((current) => ({
            ...current,
            catalogRefreshStatus: "waiting-busy",
            observedRevision,
          }));
          return;
        }

        const promoteResult =
          await getDefaultPosLocalStore().promoteRegisterCatalogVersion({
            revision: stageResult.value.revision as number,
            storeId,
          });
        if (!isAttemptCurrent()) return;
        if (!promoteResult.ok) throw promoteResult.error;
        if (!isIdleNow()) {
          setState((current) => ({
            ...current,
            catalogRefreshStatus: "waiting-busy",
            observedRevision,
          }));
          return;
        }

        const activePinResult =
          await getDefaultPosLocalStore().readRegisterCatalogPin({
            ownerId: activeOwnerId,
            storeId,
            terminalId: activeTerminalId,
          });
        if (!isAttemptCurrent()) return;
        if (!activePinResult.ok) throw activePinResult.error;
        const selectedResult = activePinResult.value
          ? await getDefaultPosLocalStore().readRegisterCatalogSelection({
              ownerId: activeOwnerId,
              storeId,
              terminalId: activeTerminalId,
            })
          : null;
        if (!isAttemptCurrent()) return;
        if (selectedResult && !selectedResult.ok) throw selectedResult.error;
        const selectedVersion = selectedResult?.value;
        if (
          selectedVersion &&
          selectedVersion.revision !== promoteResult.value.version.revision
        ) {
          appliedRevisionRef.current = selectedVersion.revision;
          setState({
            appliedRevision: selectedVersion.revision,
            catalogRefreshStatus: "waiting-busy",
            observedRevision,
            refreshedAt: selectedVersion.persistedAt,
            rows: selectedVersion.rows,
            source: "local",
            status: "ready",
          });
          return;
        }

        const version = promoteResult.value.version;
        authorizationPausedScopeRef.current = null;
        appliedRevisionRef.current = version.revision;
        if (registerTerminalId) {
          setRegisterCatalogRuntimeSelection({
            revision: version.revision,
            rows: version.rows,
            storeId,
            terminalId: registerTerminalId,
          });
        }
        lastRefreshAtRef.current = Date.now();
        retryAttemptRef.current = 0;
        setState({
          appliedRevision: version.revision,
          catalogRefreshStatus:
            typeof version.revision === "number" &&
            version.revision >= observedRevision
              ? "current"
              : "refreshing",
          observedRevision,
          refreshedAt: version.persistedAt,
          rows: version.rows,
          source: "refresh",
          status: "ready",
        });
      } catch (error) {
        if (!isAttemptCurrent()) return;
        const authorizationFailure = isAuthorizationError(error);
        authorizationPausedScopeRef.current = authorizationFailure
          ? attemptScope
          : null;
        setState((current) => ({
          ...current,
          catalogRefreshStatus: authorizationFailure
            ? "authorization-paused"
            : "retry-delayed",
          observedRevision,
        }));
        if (!authorizationFailure && !retryTimerRef.current) {
          const attempt = retryAttemptRef.current;
          retryAttemptRef.current += 1;
          const retryDelay = getRegisterCatalogRefreshRetryDelay(attempt);
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            setReconcileTick((current) => current + 1);
          }, retryDelay);
        }
      } finally {
        if (inFlightAttemptRef.current === attempt) {
          inFlightAttemptRef.current = null;
        }
        setReconcileTick((current) => current + 1);
      }
    })();
  }, [
    convex,
    isOnline,
    isOperationallyIdle,
    isRegisterRefresh,
    observedRevision,
    revisionAuthorizationPaused,
    registerTerminalId,
    registerRuntimeOwnerId,
    reconcileTick,
    scopeKey,
    storeId,
  ]);

  useEffect(
    () => () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (storeId && registerTerminalId) {
        clearRegisterCatalogRuntimeSelection({
          storeId,
          terminalId: registerTerminalId,
        });
      }
    },
    [registerTerminalId, storeId],
  );

  return state;
}

export function useConvexRegisterServiceCatalog(input: {
  storeId?: Id<"store">;
}): PosServiceCatalogRowDto[] | undefined {
  const liveRows = useQuery(
    serviceCatalogApi.serviceOps.catalog.listPosServiceCatalogSnapshot,
    input.storeId ? { storeId: input.storeId } : "skip",
  );
  const [localRows, setLocalRows] = useState<
    PosServiceCatalogRowDto[] | undefined
  >(undefined);
  const [localReadComplete, setLocalReadComplete] = useState(false);
  const storeId = input.storeId;

  useEffect(() => {
    let cancelled = false;
    setLocalRows(undefined);
    setLocalReadComplete(false);

    if (!storeId) {
      setLocalReadComplete(true);
      return;
    }

    void (async () => {
      const result =
        await getDefaultPosLocalStore().readRegisterServiceCatalogSnapshot({
          storeId,
        });

      if (cancelled) return;
      if (result.ok && result.value) {
        setLocalRows(result.value.rows);
      }
      setLocalReadComplete(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !localReadComplete || liveRows === undefined) {
      return;
    }

    void (async () => {
      const writeResult =
        await getDefaultPosLocalStore().writeRegisterServiceCatalogSnapshot({
          storeId,
          rows: liveRows,
        });

      if (writeResult.ok) {
        setLocalRows(writeResult.value.rows);
      }
    })();
  }, [liveRows, localReadComplete, storeId]);

  return localRows ?? (localReadComplete ? liveRows : undefined);
}

export function useConvexRegisterCatalogAvailability(
  input: PosRegisterCatalogAvailabilityInput,
): PosRegisterCatalogAvailabilityRowDto[] | undefined {
  const state = useConvexRegisterCatalogAvailabilityState(input);

  return state.status === "ready" ? state.rows : undefined;
}

export function usePrewarmRegisterCatalogOfflineSnapshots(input: {
  refreshAvailabilitySnapshot?: boolean;
  storeId?: Id<"store">;
}) {
  useConvexRegisterCatalog({
    refreshMetadataSnapshot: true,
    storeId: input.storeId,
  });
  useConvexRegisterServiceCatalog({ storeId: input.storeId });
  useConvexRegisterCatalogAvailabilityState({
    refreshFullAvailabilitySnapshot: input.refreshAvailabilitySnapshot ?? true,
    storeId: input.storeId,
    productSkuIds: [],
  });
}

export function useConvexRegisterCatalogAvailabilityState(
  input: PosRegisterCatalogAvailabilityInput,
): RegisterCatalogAvailabilityGatewayState {
  const convex = useConvex();
  const productSkuIdKey = (input.productSkuIds ?? []).join("\u0000");
  const requestedProductSkuIds = useMemo(
    () =>
      Array.from(
        new Set(
          (input.productSkuIds ?? []).filter(
            (productSkuId) =>
              !String(productSkuId).startsWith(LOCAL_PENDING_SKU_ID_PREFIX),
          ),
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on the stable SKU-id key, not caller array identity.
    [productSkuIdKey],
  );
  const boundedProductSkuIds = useMemo(
    () => requestedProductSkuIds.slice(0, REGISTER_CATALOG_AVAILABILITY_LIMIT),
    [requestedProductSkuIds],
  );
  const storeId = input.storeId;
  const [localState, setLocalState] =
    useState<RegisterAvailabilitySnapshotState | null>(null);
  const liveRows = useQuery(
    api.pos.public.catalog.listRegisterCatalogAvailability,
    storeId && boundedProductSkuIds.length > 0
      ? { storeId, productSkuIds: boundedProductSkuIds }
      : "skip",
  );
  const localRowsBySkuId = useMemo(() => {
    if (liveRows !== undefined || localState?.status !== "ready") {
      return null;
    }

    return new Map(
      localState.snapshot.rows.map((row) => [String(row.productSkuId), row]),
    );
  }, [liveRows, localState]);

  useEffect(() => {
    let cancelled = false;
    setLocalState(null);

    if (!storeId) {
      setLocalState({ status: "missing", snapshot: null });
      return;
    }

    if (!input.refreshFullAvailabilitySnapshot) {
      setLocalState({ status: "missing", snapshot: null });
      return;
    }

    void (async () => {
      const state = await readRegisterAvailabilitySnapshotState({
        store: getDefaultPosLocalStore(),
        storeId,
      });

      if (!cancelled) {
        setLocalState((current) => {
          if (current?.status === "ready") {
            return current;
          }

          return state;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [input.refreshFullAvailabilitySnapshot, storeId]);

  useEffect(() => {
    if (!storeId || !input.refreshFullAvailabilitySnapshot) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const refresh = await coordinateCatalogRefresh({
          refreshClass: "full-availability",
          refreshKey: "default",
          storeId,
          load: () =>
            convex.query(
              api.pos.public.catalog.listRegisterCatalogAvailabilitySnapshot,
              { storeId },
            ),
          persist: async (rows) => {
            let lastError: unknown;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const writeResult =
                await getDefaultPosLocalStore().writeRegisterAvailabilitySnapshot({
                  storeId,
                  rows,
                });
              if (writeResult.ok) return writeResult.value;
              lastError = writeResult.error;
              if (attempt === 0) {
                await new Promise((resolve) =>
                  setTimeout(
                    resolve,
                    REGISTER_AVAILABILITY_SNAPSHOT_WRITE_RETRY_DELAY_MS,
                  ),
                );
              }
            }
            throw lastError;
          },
        });

        if (cancelled) return;
        if (refresh.status === "superseded") {
          const latest = await readRegisterAvailabilitySnapshotState({
            store: getDefaultPosLocalStore(),
            storeId,
          });
          if (!cancelled) setLocalState(latest);
          return;
        }
        setLocalState({
          status: "ready",
          snapshot: refresh.value,
        });
      } catch (error) {
        if (cancelled) return;
        setLocalState((current) =>
          current?.status === "ready"
            ? current
            : {
                error: error as never,
                status: "local-store-failure",
                snapshot: null,
              },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [convex, input.refreshFullAvailabilitySnapshot, storeId]);

  if (requestedProductSkuIds.length === 0) {
    return { status: "ready", rows: [], source: "live" };
  }

  if (liveRows !== undefined) {
    return {
      status: "ready",
      rows: liveRows.map((row: PosRegisterCatalogAvailabilityRowDto) => ({
        ...row,
        availabilitySource: "live",
      })),
      source: "live",
    };
  }

  if (!localState) {
    return { status: "loading", source: "none" };
  }

  if (localState.status === "ready" && localRowsBySkuId) {
    return {
      status: "ready",
      rows: requestedProductSkuIds.flatMap((productSkuId) => {
        const row = localRowsBySkuId.get(productSkuId);
        return row ? [{ ...row, availabilitySource: "local" }] : [];
      }),
      source: "local",
    };
  }

  if (localState.status === "stale") {
    return {
      refreshedAt: localState.snapshot.refreshedAt,
      status: "stale",
      source: "local",
    };
  }

  if (localState.status === "local-store-failure") {
    return {
      error: localState.error,
      status: "local-store-failure",
      source: "none",
    };
  }

  return { status: "missing", source: "none" };
}

export function useConvexProductSearch(
  input: PosProductSearchInput,
): PosCatalogItemDto[] | undefined {
  const extracted = extractBarcodeFromInput(input.searchQuery);
  let searchQuery = input.searchQuery;

  if (extracted.type === "productId") {
    searchQuery = extracted.value;
  }

  return useQuery(
    api.pos.public.catalog.search,
    input.storeId && input.searchQuery.trim().length > 0
      ? { storeId: input.storeId, searchQuery }
      : "skip",
  );
}

export function useConvexBarcodeLookup(
  input: PosBarcodeLookupInput,
): PosCatalogItemDto | PosCatalogItemDto[] | null | undefined {
  return useQuery(
    api.pos.public.catalog.barcodeLookup,
    input.storeId && input.barcode.trim().length > 0
      ? { storeId: input.storeId, barcode: input.barcode }
      : "skip",
  );
}

export function useConvexProductIdLookup(
  input: PosProductIdLookupInput,
): PosCatalogItemDto[] | undefined {
  const normalizedProductId = input.productId.trim();
  const hasStore = !!input.storeId;
  const hasInput = normalizedProductId.length > 0;
  const isValidId = isValidConvexId(normalizedProductId);

  if (hasStore && hasInput && !isValidId) {
    console.warn("[POS] Skipping product query - invalid Convex id", {
      productId: normalizedProductId,
    });
  }

  const shouldQuery = hasStore && hasInput && isValidId;
  const productData = useQuery(
    api.inventory.products.getById,
    shouldQuery
      ? {
          includeHiddenSkus: true,
          id: normalizedProductId as Id<"product">,
          storeId: input.storeId as Id<"store">,
        }
      : "skip",
  );

  if (productData === undefined) {
    return undefined;
  }

  return mapProductByIdResult(productData as ProductByIdResult);
}

export function useConvexQuickAddCatalogItem() {
  return useMutation(api.pos.public.catalog.quickAddSku);
}

export function useConvexPendingCheckoutItemForSale() {
  return useMutation(
    (
      api.pos.public.catalog as unknown as {
        createOrReusePendingCheckoutItemForSale: FunctionReference<
          "mutation",
          "public",
          {
            storeId: Id<"store">;
            createdByStaffProfileId?: Id<"staffProfile">;
            name: string;
            lookupCode?: string;
            price: number;
            quantitySold: number;
            registerSessionId?: Id<"registerSession">;
            terminalId?: Id<"posTerminal">;
            localEventId?: string;
            source?: "online" | "offline_sync";
            timestamp?: number;
          },
          {
            id: Id<"posPendingCheckoutItem">;
            pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
            name: string;
            lookupCode: string;
            price: number;
            productId: Id<"product">;
            productSkuId: Id<"productSku">;
            quantitySold: number;
            reviewPriority: "normal" | "elevated" | "high";
            sku: string;
            status:
              | "pending_review"
              | "approved"
              | "linked_to_catalog"
              | "rejected"
              | "flagged";
          }
        >;
      }
    ).createOrReusePendingCheckoutItemForSale,
  );
}

export type PendingCheckoutReviewItem = {
  _id: Id<"posPendingCheckoutItem">;
  name: string;
  lookupCode?: string;
  provisionalPrice: number;
  status:
    | "pending_review"
    | "approved"
    | "linked_to_catalog"
    | "rejected"
    | "flagged";
  reviewPriority: "normal" | "elevated" | "high";
  evidence: {
    totalQuantitySold?: number;
    transactionCount?: number;
    observedPrices?: number[];
    observedLookupCodes?: string[];
    offlineSaleCount?: number;
  };
  createdAt: number;
  updatedAt: number;
  createdFrom: "online" | "offline_sync";
};

export function useConvexPendingCheckoutItemsForReview(input: {
  storeId?: Id<"store">;
}) {
  return useQuery(
    (
      api.pos.public.catalog as unknown as {
        listPendingCheckoutItemsForReview: FunctionReference<
          "query",
          "public",
          { storeId: Id<"store"> },
          PendingCheckoutReviewItem[]
        >;
      }
    ).listPendingCheckoutItemsForReview,
    input.storeId ? { storeId: input.storeId } : "skip",
  );
}

export function useConvexResolvePendingCheckoutItemReview() {
  return useMutation(
    (
      api.pos.public.catalog as unknown as {
        resolvePendingCheckoutItemReview: FunctionReference<
          "mutation",
          "public",
          {
            storeId: Id<"store">;
            pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
            status: "approved" | "linked_to_catalog" | "rejected" | "flagged";
            note?: string;
            approvedProductId?: Id<"product">;
            approvedProductSkuId?: Id<"productSku">;
          },
          CommandResult<PendingCheckoutReviewItem>
        >;
      }
    ).resolvePendingCheckoutItemReview,
  );
}

export const convexCatalogReader: PosCatalogReader = {
  useRegisterCatalog: useConvexRegisterCatalog,
  useRegisterServiceCatalog: useConvexRegisterServiceCatalog,
  useRegisterCatalogAvailability: useConvexRegisterCatalogAvailability,
  useProductSearch: useConvexProductSearch,
  useBarcodeLookup: useConvexBarcodeLookup,
  useProductIdLookup: useConvexProductIdLookup,
};

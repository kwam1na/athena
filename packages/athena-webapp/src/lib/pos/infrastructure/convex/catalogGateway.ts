import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useEffect, useMemo, useState } from "react";

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
      refreshedAt: number;
      rows: PosRegisterCatalogRowDto[];
      source: "local" | "refresh";
      status: "ready";
    }
  | {
      refreshedAt?: number;
      rows?: PosRegisterCatalogRowDto[];
      source: "local" | "none";
      status: "refreshing";
    }
  | {
      rows?: undefined;
      source: "none";
      status: "loading" | "missing";
    }
  | {
      error: unknown;
      rows?: undefined;
      source: "none";
      status: "local-store-failure";
    }
  | {
      error: unknown;
      refreshedAt?: number;
      rows?: PosRegisterCatalogRowDto[];
      source: "local" | "none";
      status: "refresh-failed";
    };

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
  const storeId = input.storeId;
  const [state, setState] = useState<RegisterCatalogMetadataGatewayState>(() =>
    shouldRefresh
      ? { rows: undefined, source: "none", status: "refreshing" }
      : { source: "none", status: "loading" },
  );

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
        await getDefaultPosLocalStore().readRegisterCatalogSnapshot({
          storeId,
        });

      if (cancelled) return;
      if (result.ok && result.value) {
        const snapshot = result.value;
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
  }, [shouldRefresh, storeId]);

  useEffect(() => {
    if (!storeId || !shouldRefresh) {
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
  }, [convex, refreshKey, shouldRefresh, storeId]);

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

import { useMutation, useQuery } from "convex/react";
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
} from "@/lib/pos/application/dto";
import type { PosCatalogReader } from "@/lib/pos/application/ports";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
} from "@/lib/pos/infrastructure/local/posLocalStore";
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

const REGISTER_CATALOG_AVAILABILITY_LIMIT = 50;
const REGISTER_AVAILABILITY_SNAPSHOT_WRITE_RETRY_DELAY_MS = 250;

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

  const availableSkus = productData.skus.filter((sku) => sku.isVisible);

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
  }));
}

function signatureForAvailabilityRows(
  storeId: string,
  rows: readonly PosRegisterCatalogAvailabilityRowDto[],
) {
  return `${storeId}|${rows
    .map(
      (row) =>
        `${String(row.productSkuId)}:${row.quantityAvailable}:${row.inStock ? 1 : 0}`,
    )
    .join("|")}`;
}

export function useConvexRegisterCatalog(
  input: PosRegisterCatalogInput,
): PosRegisterCatalogRowDto[] | undefined {
  const liveRows = useQuery(
    api.pos.public.catalog.listRegisterCatalogSnapshot,
    input.storeId ? { storeId: input.storeId } : "skip",
  );
  const [localRows, setLocalRows] = useState<
    PosRegisterCatalogRowDto[] | undefined
  >(undefined);
  const storeId = input.storeId;

  useEffect(() => {
    let cancelled = false;
    setLocalRows(undefined);

    if (!storeId || typeof indexedDB === "undefined") {
      return;
    }

    void (async () => {
      const result = await createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      }).readRegisterCatalogSnapshot({ storeId });

      if (cancelled) return;
      if (result.ok && result.value) {
        setLocalRows(result.value.rows);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId || liveRows === undefined || typeof indexedDB === "undefined") {
      return;
    }

    setLocalRows(liveRows);
    void createPosLocalStore({
      adapter: createIndexedDbPosLocalStorageAdapter(),
    }).writeRegisterCatalogSnapshot({ storeId, rows: liveRows });
  }, [liveRows, storeId]);

  return liveRows ?? localRows;
}

export function useConvexRegisterCatalogAvailability(
  input: PosRegisterCatalogAvailabilityInput,
): PosRegisterCatalogAvailabilityRowDto[] | undefined {
  const state = useConvexRegisterCatalogAvailabilityState(input);

  return state.status === "ready" ? state.rows : undefined;
}

export function usePrewarmRegisterCatalogOfflineSnapshots(input: {
  storeId?: Id<"store">;
}) {
  useConvexRegisterCatalog({ storeId: input.storeId });
  useConvexRegisterCatalogAvailabilityState({
    refreshFullAvailabilitySnapshot: true,
    storeId: input.storeId,
    productSkuIds: [],
  });
}

export function useConvexRegisterCatalogAvailabilityState(
  input: PosRegisterCatalogAvailabilityInput,
): RegisterCatalogAvailabilityGatewayState {
  const productSkuIdKey = (input.productSkuIds ?? []).join("\u0000");
  const requestedProductSkuIds = useMemo(
    () => Array.from(new Set(input.productSkuIds ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on the stable SKU-id key, not caller array identity.
    [productSkuIdKey],
  );
  const boundedProductSkuIds = useMemo(
    () =>
      requestedProductSkuIds.slice(0, REGISTER_CATALOG_AVAILABILITY_LIMIT),
    [requestedProductSkuIds],
  );
  const storeId = input.storeId;
  const [localState, setLocalState] =
    useState<RegisterAvailabilitySnapshotState | null>(null);
  const [pendingFullSnapshotRefreshStoreId, setPendingFullSnapshotRefreshStoreId] =
    useState<string | null>(null);
  const [pendingFullSnapshotPersistence, setPendingFullSnapshotPersistence] =
    useState<{
      retryAttempt: number;
      rows: PosRegisterCatalogAvailabilityRowDto[];
      signature: string;
      storeId: string;
    } | null>(null);
  const lastPersistedFullSnapshotSignatureRef = useRef<string | null>(null);
  const liveRows = useQuery(
    api.pos.public.catalog.listRegisterCatalogAvailability,
    storeId && boundedProductSkuIds.length > 0
      ? { storeId, productSkuIds: boundedProductSkuIds }
      : "skip",
  );
  const shouldRefreshFullSnapshot = Boolean(
    input.refreshFullAvailabilitySnapshot &&
      storeId &&
      pendingFullSnapshotRefreshStoreId === storeId,
  );
  const fullSnapshotRows = useQuery(
    api.pos.public.catalog.listRegisterCatalogAvailabilitySnapshot,
    shouldRefreshFullSnapshot ? { storeId: storeId! } : "skip",
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
      setPendingFullSnapshotRefreshStoreId(null);
      setPendingFullSnapshotPersistence(null);
      return;
    }

    if (!input.refreshFullAvailabilitySnapshot) {
      setLocalState({ status: "missing", snapshot: null });
      setPendingFullSnapshotRefreshStoreId(null);
      setPendingFullSnapshotPersistence(null);
      return;
    }

    setPendingFullSnapshotRefreshStoreId(storeId);

    if (typeof indexedDB === "undefined") {
      setLocalState({
        error: {
          code: "write_failed",
          message: "POS local store is unavailable in this browser context.",
        },
        status: "local-store-failure",
        snapshot: null,
      });
      return;
    }

    void (async () => {
      const state = await readRegisterAvailabilitySnapshotState({
        store: createPosLocalStore({
          adapter: createIndexedDbPosLocalStorageAdapter(),
        }),
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
    if (
      !storeId ||
      fullSnapshotRows === undefined ||
      typeof indexedDB === "undefined"
    ) {
      return;
    }

    const nextSignature = signatureForAvailabilityRows(storeId, fullSnapshotRows);
    setPendingFullSnapshotRefreshStoreId((current) =>
      current === storeId ? null : current,
    );
    if (lastPersistedFullSnapshotSignatureRef.current === nextSignature) {
      return;
    }

    setPendingFullSnapshotPersistence({
      retryAttempt: 0,
      rows: fullSnapshotRows,
      signature: nextSignature,
      storeId,
    });
  }, [fullSnapshotRows, storeId]);

  useEffect(() => {
    if (!pendingFullSnapshotPersistence || typeof indexedDB === "undefined") {
      return;
    }

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    const snapshot = pendingFullSnapshotPersistence;

    void (async () => {
      const writeResult = await createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      }).writeRegisterAvailabilitySnapshot({
        storeId: snapshot.storeId,
        rows: snapshot.rows,
      });

      if (cancelled) return;

      if (writeResult.ok) {
        lastPersistedFullSnapshotSignatureRef.current = snapshot.signature;
        setPendingFullSnapshotPersistence((current) =>
          current?.signature === snapshot.signature &&
          current.storeId === snapshot.storeId
            ? null
            : current,
        );
        setLocalState({
          status: "ready",
          snapshot: writeResult.value,
        });
        return;
      }

      setLocalState({
        error: writeResult.error,
        status: "local-store-failure",
        snapshot: null,
      });
      retryTimeout = setTimeout(() => {
        setPendingFullSnapshotPersistence((current) =>
          current?.signature === snapshot.signature &&
          current.storeId === snapshot.storeId &&
          current.retryAttempt === snapshot.retryAttempt
            ? { ...current, retryAttempt: current.retryAttempt + 1 }
            : current,
        );
      }, REGISTER_AVAILABILITY_SNAPSHOT_WRITE_RETRY_DELAY_MS);
    })();

    return () => {
      cancelled = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [pendingFullSnapshotPersistence]);

  if (requestedProductSkuIds.length === 0) {
    return { status: "ready", rows: [], source: "live" };
  }

  if (liveRows !== undefined) {
    return {
      status: "ready",
      rows: liveRows.map((row) => ({ ...row, availabilitySource: "live" })),
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

export const convexCatalogReader: PosCatalogReader = {
  useRegisterCatalog: useConvexRegisterCatalog,
  useRegisterCatalogAvailability: useConvexRegisterCatalogAvailability,
  useProductSearch: useConvexProductSearch,
  useBarcodeLookup: useConvexBarcodeLookup,
  useProductIdLookup: useConvexProductIdLookup,
};

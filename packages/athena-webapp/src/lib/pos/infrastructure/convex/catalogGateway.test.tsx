import { act, renderHook, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PosRegisterCatalogAvailabilityRowDto,
  PosRegisterCatalogRowDto,
  PosServiceCatalogRowDto,
} from "@/lib/pos/application/dto";
import type { Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import {
  __resetCatalogRefreshCoordinatorForTests,
  getRegisterCatalogRefreshRetryDelay,
  useConvexRegisterCatalog,
  useConvexRegisterCatalogState,
  useConvexRegisterCatalogAvailability,
  useConvexRegisterCatalogAvailabilityState,
  useConvexProductIdLookup,
  useConvexRegisterServiceCatalog,
  usePrewarmRegisterCatalogOfflineSnapshots,
} from "./catalogGateway";
import {
  captureRegisterCatalogRuntimePin,
  clearRegisterCatalogRuntimeActionGuard,
  hasRegisterCatalogRuntimeActionGuard,
} from "@/lib/pos/infrastructure/local/registerCatalogPinRuntime";

const catalogStoreMocks = vi.hoisted(() => ({
  promoteRegisterCatalogVersion: vi.fn(),
  readRegisterAvailabilitySnapshot: vi.fn(),
  readRegisterCatalogSnapshot: vi.fn(),
  readRegisterCatalogSelection: vi.fn(),
  readRegisterCatalogPin: vi.fn(),
  readRegisterCatalogVersionState: vi.fn(),
  readRegisterServiceCatalogSnapshot: vi.fn(),
  stageRegisterCatalogVersion: vi.fn(),
  pinRegisterCatalogVersion: vi.fn(),
  releaseRegisterCatalogPin: vi.fn(),
  renewRegisterCatalogPinLease: vi.fn(),
  writeRegisterAvailabilitySnapshot: vi.fn(),
  writeRegisterCatalogSnapshot: vi.fn(),
  writeRegisterServiceCatalogSnapshot: vi.fn(),
}));
const convexMocks = vi.hoisted(() => ({
  query: vi.fn(),
  useConvex: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvex: convexMocks.useConvex,
  useMutation: convexMocks.useMutation,
  useQuery: convexMocks.useQuery,
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: vi.fn(() => catalogStoreMocks),
}));

function buildRegisterCatalogRow(
  overrides: Partial<PosRegisterCatalogRowDto> = {},
): PosRegisterCatalogRowDto {
  return {
    id: "sku-1" as Id<"productSku">,
    productSkuId: "sku-1" as Id<"productSku">,
    skuId: "sku-1" as Id<"productSku">,
    productId: "product-1" as Id<"product">,
    name: "Deep Wave",
    sku: "DW-18",
    barcode: "1234567890123",
    price: 10_000,
    category: "Hair",
    description: "Deep wave bundle",
    image: null,
    size: "18",
    length: 18,
    color: "natural",
    areProcessingFeesAbsorbed: false,
    ...overrides,
  };
}

function buildAvailabilityRow(
  overrides: Partial<PosRegisterCatalogAvailabilityRowDto> = {},
): PosRegisterCatalogAvailabilityRowDto {
  return {
    productSkuId: "sku-1" as Id<"productSku">,
    skuId: "sku-1" as Id<"productSku">,
    inStock: true,
    quantityAvailable: 5,
    ...overrides,
  };
}

function buildServiceCatalogRow(
  overrides: Partial<PosServiceCatalogRowDto> = {},
): PosServiceCatalogRowDto {
  return {
    serviceCatalogId: "service-1" as Id<"serviceCatalog">,
    name: "Closure Repair",
    description: "Repair a closure install",
    serviceMode: "repair",
    pricingModel: "fixed",
    basePrice: 4_500,
    depositType: "none",
    requiresManagerApproval: false,
    status: "active",
    updatedAt: 1_000,
    checkoutReadiness: {
      canCheckoutDirectly: true,
      message: "Ready for checkout.",
      reason: "fixed_price",
      status: "ready",
      suggestedAmount: 4_500,
    },
    ...overrides,
  };
}

describe("catalogGateway", () => {
  let liveAvailabilityRows: PosRegisterCatalogAvailabilityRowDto[] | undefined;
  let fullAvailabilitySnapshotRows:
    PosRegisterCatalogAvailabilityRowDto[] | undefined;

  beforeEach(() => {
    __resetCatalogRefreshCoordinatorForTests();
    clearRegisterCatalogRuntimeActionGuard({
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    liveAvailabilityRows = undefined;
    fullAvailabilitySnapshotRows = undefined;
    convexMocks.query.mockReset();
    convexMocks.query.mockImplementation((query) => {
      if (
        getFunctionName(query) ===
        "pos/public/catalog:listRegisterCatalogAvailabilitySnapshot"
      ) {
        return fullAvailabilitySnapshotRows === undefined
          ? new Promise(() => undefined)
          : Promise.resolve(fullAvailabilitySnapshotRows);
      }
      return Promise.resolve([]);
    });
    convexMocks.useConvex.mockReset();
    convexMocks.useConvex.mockReturnValue({ query: convexMocks.query });
    convexMocks.useMutation.mockReset();
    convexMocks.useQuery.mockReset();
    convexMocks.useQuery.mockImplementation((_query, args) => {
      if (args === "skip") return undefined;
      if ("productSkuIds" in args) return liveAvailabilityRows;
      return fullAvailabilitySnapshotRows;
    });
    catalogStoreMocks.readRegisterAvailabilitySnapshot.mockReset();
    catalogStoreMocks.readRegisterCatalogSnapshot.mockReset();
    catalogStoreMocks.readRegisterCatalogSelection.mockReset();
    catalogStoreMocks.readRegisterCatalogPin.mockReset();
    catalogStoreMocks.readRegisterCatalogVersionState.mockReset();
    catalogStoreMocks.readRegisterServiceCatalogSnapshot.mockReset();
    catalogStoreMocks.stageRegisterCatalogVersion.mockReset();
    catalogStoreMocks.promoteRegisterCatalogVersion.mockReset();
    catalogStoreMocks.pinRegisterCatalogVersion.mockReset();
    catalogStoreMocks.releaseRegisterCatalogPin.mockReset();
    catalogStoreMocks.renewRegisterCatalogPinLease.mockReset();
    catalogStoreMocks.writeRegisterAvailabilitySnapshot.mockReset();
    catalogStoreMocks.writeRegisterCatalogSnapshot.mockReset();
    catalogStoreMocks.writeRegisterServiceCatalogSnapshot.mockReset();
    catalogStoreMocks.readRegisterAvailabilitySnapshot.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.readRegisterCatalogSnapshot.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.readRegisterCatalogVersionState.mockResolvedValue({
      ok: true,
      value: {
        active: null,
        activeRevision: null,
        staged: null,
        stagedRevision: null,
      },
    });
    catalogStoreMocks.readRegisterCatalogPin.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.pinRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.releaseRegisterCatalogPin.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.renewRegisterCatalogPinLease.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.readRegisterServiceCatalogSnapshot.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.writeRegisterAvailabilitySnapshot.mockImplementation(
      async (input: {
        rows: PosRegisterCatalogAvailabilityRowDto[];
        storeId: string;
      }) => ({
        ok: true,
        value: {
          refreshedAt: Date.now(),
          rows: input.rows,
          schemaVersion: 4,
          storeId: input.storeId,
        },
      }),
    );
    catalogStoreMocks.writeRegisterCatalogSnapshot.mockImplementation(
      async (input: { rows: PosRegisterCatalogRowDto[]; storeId: string }) => ({
        ok: true,
        value: {
          refreshedAt: Date.now(),
          rows: input.rows,
          schemaVersion: 8,
          storeId: input.storeId,
        },
      }),
    );
    catalogStoreMocks.writeRegisterServiceCatalogSnapshot.mockResolvedValue({
      ok: true,
      value: null,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {} as IDBFactory,
    });
  });

  it("backs repeated full-snapshot failures into a quiet retry period", () => {
    expect(
      [0, 1, 2, 3, 4, 5].map(getRegisterCatalogRefreshRetryDelay),
    ).toEqual([1_000, 2_000, 4_000, 8_000, 60_000, 60_000]);
  });

  it("returns the cached register catalog snapshot without subscribing to full metadata", async () => {
    const cachedRows = [buildRegisterCatalogRow()];
    catalogStoreMocks.readRegisterCatalogSnapshot.mockResolvedValue({
      ok: true,
      value: {
        refreshedAt: 1_700,
        rows: cachedRows,
        schemaVersion: 4,
        storeId: "store-1",
      },
    });

    const { result } = renderHook(() =>
      useConvexRegisterCatalog({ storeId: "store-1" as Id<"store"> }),
    );

    await waitFor(() => expect(result.current).toEqual(cachedRows));
    expect(
      convexMocks.useQuery.mock.calls.every(([, args]) => args === "skip"),
    ).toBe(true);
    expect(convexMocks.query).not.toHaveBeenCalled();
    expect(catalogStoreMocks.readRegisterCatalogSnapshot).toHaveBeenCalledWith({
      storeId: "store-1",
    });
    expect(
      catalogStoreMocks.writeRegisterCatalogSnapshot,
    ).not.toHaveBeenCalled();
  });

  it("keeps the register catalog loading when neither live data nor a local snapshot is available", async () => {
    catalogStoreMocks.readRegisterCatalogSnapshot.mockResolvedValue({
      ok: true,
      value: null,
    });

    const { result } = renderHook(() =>
      useConvexRegisterCatalog({ storeId: "store-1" as Id<"store"> }),
    );

    await waitFor(() =>
      expect(catalogStoreMocks.readRegisterCatalogSnapshot).toHaveBeenCalled(),
    );
    expect(result.current).toBeUndefined();
    expect(
      convexMocks.useQuery.mock.calls.every(([, args]) => args === "skip"),
    ).toBe(true);
    expect(convexMocks.query).not.toHaveBeenCalled();
  });

  it("honors POS SKU visibility when mapping product-id lookup results", async () => {
    convexMocks.useQuery.mockReturnValue({
      _id: "ks7ab1h23h38zjz2pw1wpdfr5d88d2h8",
      name: "Needle Sewing",
      description: "Needle product",
      skus: [
        {
          _id: "sku-online-hidden" as Id<"productSku">,
          sku: "ONLINE-HIDDEN",
          barcode: "111",
          images: [],
          isVisible: false,
          posVisible: true,
          price: 500,
          quantityAvailable: 1,
        },
        {
          _id: "sku-legacy-hidden" as Id<"productSku">,
          sku: "LEGACY-HIDDEN",
          barcode: "333",
          images: [],
          isVisible: false,
          price: 900,
          quantityAvailable: 1,
        },
        {
          _id: "sku-pos-hidden" as Id<"productSku">,
          sku: "POS-HIDDEN",
          barcode: "222",
          images: [],
          isVisible: true,
          posVisible: false,
          price: 700,
          quantityAvailable: 1,
        },
      ],
    });

    const { result } = renderHook(() =>
      useConvexProductIdLookup({
        productId: "ks7ab1h23h38zjz2pw1wpdfr5d88d2h8" as Id<"product">,
        storeId: "store-1" as Id<"store">,
      }),
    );

    expect(result.current?.map((row) => row.sku)).toEqual(["ONLINE-HIDDEN"]);
    expect(convexMocks.useQuery).toHaveBeenCalledWith(expect.anything(), {
      id: "ks7ab1h23h38zjz2pw1wpdfr5d88d2h8",
      includeHiddenSkus: true,
      storeId: "store-1",
    });
  });

  it("persists explicitly refreshed register catalog rows for the next offline lookup", async () => {
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-20" })];
    convexMocks.query.mockResolvedValue(refreshedRows);

    const { result } = renderHook(() =>
      useConvexRegisterCatalog({
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() => expect(result.current).toEqual(refreshedRows));
    expect(
      convexMocks.useQuery.mock.calls.every(([, args]) => args === "skip"),
    ).toBe(true);
    expect(convexMocks.query).toHaveBeenCalledWith(expect.anything(), {
      storeId: "store-1",
    });
    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterCatalogSnapshot,
      ).toHaveBeenCalledWith({
        storeId: "store-1",
        rows: refreshedRows,
      }),
    );
  });

  it("shares one metadata query and persistence across concurrent consumers for one store", async () => {
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-SHARED" })];
    let resolveRows!: (rows: PosRegisterCatalogRowDto[]) => void;
    convexMocks.query.mockReturnValue(
      new Promise<PosRegisterCatalogRowDto[]>((resolve) => {
        resolveRows = resolve;
      }),
    );

    const first = renderHook(() =>
      useConvexRegisterCatalogState({
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );
    const second = renderHook(() =>
      useConvexRegisterCatalogState({
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() => expect(convexMocks.query).toHaveBeenCalledTimes(1));
    resolveRows(refreshedRows);

    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledTimes(1);
  });

  it("reuses a recently completed metadata refresh for a later consumer", async () => {
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-RECENT" })];
    convexMocks.query.mockResolvedValue(refreshedRows);

    const first = renderHook(() =>
      useConvexRegisterCatalogState({
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );
    await waitFor(() => expect(first.result.current.status).toBe("ready"));

    const second = renderHook(() =>
      useConvexRegisterCatalogState({
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );
    await waitFor(() => expect(second.result.current.status).toBe("ready"));

    expect(convexMocks.query).toHaveBeenCalledTimes(1);
    expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledTimes(1);
  });

  it("isolates refresh ownership between stores", async () => {
    convexMocks.query.mockResolvedValue([buildRegisterCatalogRow()]);

    const first = renderHook(() =>
      useConvexRegisterCatalogState({
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );
    const second = renderHook(() =>
      useConvexRegisterCatalogState({
        refreshMetadataSnapshot: true,
        storeId: "store-2" as Id<"store">,
      }),
    );

    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(convexMocks.query).toHaveBeenCalledTimes(2);
    expect(
      convexMocks.query.mock.calls.map(([, args]) => args.storeId).sort(),
    ).toEqual(["store-1", "store-2"]);
  });

  it("clears failed metadata ownership so a later consumer can retry", async () => {
    convexMocks.query
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce([buildRegisterCatalogRow({ sku: "RETRY" })]);

    const first = renderHook(() =>
      useConvexRegisterCatalogState({
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );
    await waitFor(() =>
      expect(first.result.current.status).toBe("refresh-failed"),
    );
    first.unmount();

    const retry = renderHook(() =>
      useConvexRegisterCatalogState({
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );
    await waitFor(() => expect(retry.result.current.status).toBe("ready"));
    expect(convexMocks.query).toHaveBeenCalledTimes(2);
  });

  it("keeps metadata and full-availability refresh classes independent", async () => {
    const metadataRows = [buildRegisterCatalogRow({ sku: "META" })];
    fullAvailabilitySnapshotRows = [buildAvailabilityRow()];
    convexMocks.query.mockImplementation((query) =>
      getFunctionName(query) ===
      "pos/public/catalog:listRegisterCatalogAvailabilitySnapshot"
        ? Promise.resolve(fullAvailabilitySnapshotRows)
        : Promise.resolve(metadataRows),
    );

    renderHook(() =>
      useConvexRegisterCatalogState({
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );
    renderHook(() =>
      useConvexRegisterCatalogAvailabilityState({
        refreshFullAvailabilitySnapshot: true,
        productSkuIds: [],
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() => expect(convexMocks.query).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterAvailabilitySnapshot,
      ).toHaveBeenCalledTimes(1),
    );
  });

  it("does not let an older explicit metadata refresh overwrite a newer generation", async () => {
    const resolvers = new Map<string, (rows: PosRegisterCatalogRowDto[]) => void>();
    convexMocks.query.mockImplementation(
      () =>
        new Promise<PosRegisterCatalogRowDto[]>((resolve) => {
          resolvers.set(String(resolvers.size), resolve);
        }),
    );

    const older = renderHook(
      ({ refreshKey }) =>
        useConvexRegisterCatalogState({
          metadataRefreshKey: refreshKey,
          refreshMetadataSnapshot: true,
          storeId: "store-1" as Id<"store">,
        }),
      { initialProps: { refreshKey: "generation-1" } },
    );
    older.rerender({ refreshKey: "generation-2" });

    await waitFor(() => expect(convexMocks.query).toHaveBeenCalledTimes(2));
    resolvers.get("1")?.([buildRegisterCatalogRow({ sku: "NEW" })]);
    await waitFor(() => expect(older.result.current.status).toBe("ready"));
    resolvers.get("0")?.([buildRegisterCatalogRow({ sku: "OLD" })]);

    await waitFor(() =>
      expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledTimes(1),
    );
    expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledWith({
      storeId: "store-1",
      rows: [expect.objectContaining({ sku: "NEW" })],
    });
  });

  it("settles a superseded consumer from the newer persisted generation", async () => {
    const resolvers: Array<(rows: PosRegisterCatalogRowDto[]) => void> = [];
    let persistedRows: PosRegisterCatalogRowDto[] | null = null;
    convexMocks.query.mockImplementation(
      () =>
        new Promise<PosRegisterCatalogRowDto[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    catalogStoreMocks.writeRegisterCatalogSnapshot.mockImplementation(
      async (input: { rows: PosRegisterCatalogRowDto[]; storeId: string }) => {
        persistedRows = input.rows;
        return {
          ok: true,
          value: {
            refreshedAt: 2_000,
            rows: input.rows,
            schemaVersion: 8,
            storeId: input.storeId,
          },
        };
      },
    );
    catalogStoreMocks.readRegisterCatalogSnapshot.mockImplementation(
      async () => ({
        ok: true,
        value: persistedRows
          ? {
              refreshedAt: 2_000,
              rows: persistedRows,
              schemaVersion: 8,
              storeId: "store-1",
            }
          : null,
      }),
    );

    const older = renderHook(() =>
      useConvexRegisterCatalogState({
        metadataRefreshKey: "generation-1",
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );
    const newer = renderHook(() =>
      useConvexRegisterCatalogState({
        metadataRefreshKey: "generation-2",
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() => expect(convexMocks.query).toHaveBeenCalledTimes(2));
    resolvers[1]?.([buildRegisterCatalogRow({ sku: "NEW" })]);
    await waitFor(() => expect(newer.result.current.status).toBe("ready"));
    resolvers[0]?.([buildRegisterCatalogRow({ sku: "OLD" })]);

    await waitFor(() =>
      expect(older.result.current).toEqual({
        refreshedAt: 2_000,
        rows: [expect.objectContaining({ sku: "NEW" })],
        source: "local",
        status: "ready",
      }),
    );
    expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledTimes(1);
  });

  it("exposes explicit register catalog metadata refresh state", async () => {
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-22" })];
    convexMocks.query.mockResolvedValue(refreshedRows);

    const { result } = renderHook(() =>
      useConvexRegisterCatalogState({
        metadataRefreshKey: "price-and-barcode-change",
        refreshMetadataSnapshot: true,
        storeId: "store-1" as Id<"store">,
      }),
    );

    expect(result.current).toEqual({
      rows: undefined,
      source: "none",
      status: "refreshing",
    });
    await waitFor(() =>
      expect(result.current).toEqual({
        refreshedAt: expect.any(Number),
        rows: refreshedRows,
        source: "refresh",
        status: "ready",
      }),
    );
  });

  it("observes a tiny revision and promotes one durable refresh while idle", async () => {
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-OLD" })];
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-NEW" })];
    const priorVersion = {
      persistedAt: 1_000,
      revision: 1,
      rows: priorRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    const refreshedVersion = {
      ...priorVersion,
      revision: 2,
      rows: refreshedRows,
    };
    convexMocks.useQuery.mockReturnValue({ revision: 2, status: "ready" });
    convexMocks.query.mockResolvedValue({ revision: 2, rows: refreshedRows });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: priorVersion,
    });
    catalogStoreMocks.readRegisterCatalogVersionState.mockResolvedValue({
      ok: true,
      value: {
        active: priorVersion,
        activeRevision: 1,
        staged: null,
        stagedRevision: null,
      },
    });
    catalogStoreMocks.stageRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "staged", version: refreshedVersion },
    });
    catalogStoreMocks.promoteRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "promoted", version: refreshedVersion },
    });

    const { result } = renderHook(() =>
      useConvexRegisterCatalogState({
        registerRefresh: {
          isOperationallyIdle: true,
          terminalId: "terminal-1",
        },
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() => expect(result.current.rows).toEqual(refreshedRows));
    expect(convexMocks.useQuery).toHaveBeenCalledWith(expect.anything(), {
      storeId: "store-1",
    });
    expect(convexMocks.query).toHaveBeenCalledWith(expect.anything(), {
      storeId: "store-1",
    });
    expect(catalogStoreMocks.stageRegisterCatalogVersion).toHaveBeenCalledWith({
      revision: 2,
      rows: refreshedRows,
      storeId: "store-1",
    });
    expect(
      catalogStoreMocks.promoteRegisterCatalogVersion,
    ).toHaveBeenCalledWith({
      revision: 2,
      storeId: "store-1",
    });
    expect(result.current).toMatchObject({
      appliedRevision: 2,
      catalogRefreshStatus: "current",
      observedRevision: 2,
      source: "refresh",
      status: "ready",
    });
  });

  it("defers the full read while the register is busy and keeps trusted rows", async () => {
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-PINNED" })];
    const priorVersion = {
      persistedAt: 1_000,
      revision: 1,
      rows: priorRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    convexMocks.useQuery.mockReturnValue({ revision: 3, status: "ready" });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: priorVersion,
    });

    const { result } = renderHook(() =>
      useConvexRegisterCatalogState({
        registerRefresh: {
          isOperationallyIdle: false,
          terminalId: "terminal-1",
        },
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() => expect(result.current.rows).toEqual(priorRows));
    expect(result.current).toMatchObject({
      appliedRevision: 1,
      catalogRefreshStatus: "waiting-busy",
      observedRevision: 3,
    });
    expect(convexMocks.query).not.toHaveBeenCalled();
    expect(
      catalogStoreMocks.stageRegisterCatalogVersion,
    ).not.toHaveBeenCalled();
    expect(
      catalogStoreMocks.promoteRegisterCatalogVersion,
    ).not.toHaveBeenCalled();
    expect(catalogStoreMocks.pinRegisterCatalogVersion).not.toHaveBeenCalled();
  });

  it("renews the mounted owner's pin lease only while the register is non-idle", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-PINNED" })];
    convexMocks.useQuery.mockReturnValue({ revision: 1, status: "ready" });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: {
        persistedAt: 1_000,
        revision: 1,
        rows: priorRows,
        schemaVersion: 9,
        storeId: "store-1",
      },
    });

    const { rerender } = renderHook(
      ({ isIdle }) =>
        useConvexRegisterCatalogState({
          registerRefresh: {
            isOperationallyIdle: isIdle,
            ownerId: "runtime-owner-1",
            terminalId: "terminal-1",
          },
          storeId: "store-1" as Id<"store">,
        }),
      { initialProps: { isIdle: false } },
    );

    await waitFor(() =>
      expect(
        catalogStoreMocks.renewRegisterCatalogPinLease,
      ).toHaveBeenCalledWith({
        ownerId: "runtime-owner-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );

    rerender({ isIdle: true });
    await waitFor(() => expect(clearIntervalSpy).toHaveBeenCalled());
    clearIntervalSpy.mockRestore();
  });

  it("releases the runtime pin only after the register returns to idle", async () => {
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-PINNED" })];
    const priorVersion = {
      persistedAt: 1_000,
      revision: 1,
      rows: priorRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    convexMocks.useQuery.mockReturnValue({ revision: 1, status: "ready" });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: priorVersion,
    });
    catalogStoreMocks.readRegisterCatalogPin.mockResolvedValue({
      ok: true,
      value: {
        pinnedAt: 900,
        revision: 1,
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    const { rerender } = renderHook(
      ({ isIdle }) =>
        useConvexRegisterCatalogState({
          registerRefresh: {
            isOperationallyIdle: isIdle,
            terminalId: "terminal-1",
          },
          storeId: "store-1" as Id<"store">,
        }),
      { initialProps: { isIdle: false } },
    );

    await waitFor(() =>
      expect(catalogStoreMocks.readRegisterCatalogSelection).toHaveBeenCalled(),
    );
    expect(catalogStoreMocks.pinRegisterCatalogVersion).not.toHaveBeenCalled();
    expect(catalogStoreMocks.releaseRegisterCatalogPin).not.toHaveBeenCalled();

    rerender({ isIdle: true });

    await waitFor(() =>
      expect(
        catalogStoreMocks.releaseRegisterCatalogPin,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: expect.stringMatching(/^register-runtime-/),
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      ),
    );
  });

  it("never exposes fetched rows when durable staging fails", async () => {
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-TRUSTED" })];
    const incomingRows = [buildRegisterCatalogRow({ sku: "DW-UNPERSISTED" })];
    const priorVersion = {
      persistedAt: 1_000,
      revision: 1,
      rows: priorRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    convexMocks.useQuery.mockReturnValue({ revision: 2, status: "ready" });
    convexMocks.query.mockResolvedValue({ revision: 2, rows: incomingRows });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: priorVersion,
    });
    catalogStoreMocks.stageRegisterCatalogVersion.mockResolvedValue({
      ok: false,
      error: { code: "write_failed", message: "disk full" },
    });

    const { result } = renderHook(() =>
      useConvexRegisterCatalogState({
        registerRefresh: {
          isOperationallyIdle: true,
          terminalId: "terminal-1",
        },
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() =>
      expect(result.current.catalogRefreshStatus).toBe("retry-delayed"),
    );
    expect(result.current.rows).toEqual(priorRows);
    expect(result.current.rows).not.toEqual(incomingRows);
    expect(
      catalogStoreMocks.promoteRegisterCatalogVersion,
    ).not.toHaveBeenCalled();
  });

  it("keeps prior rows when sale work starts during the promotion commit", async () => {
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-PRIOR" })];
    const incomingRows = [buildRegisterCatalogRow({ sku: "DW-INCOMING" })];
    const priorVersion = {
      persistedAt: 1_000,
      revision: 1,
      rows: priorRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    const incomingVersion = {
      ...priorVersion,
      revision: 2,
      rows: incomingRows,
    };
    let resolvePromotion!: (value: unknown) => void;
    convexMocks.useQuery.mockReturnValue({ revision: 2, status: "ready" });
    convexMocks.query.mockResolvedValue({ revision: 2, rows: incomingRows });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: priorVersion,
    });
    catalogStoreMocks.stageRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "staged", version: incomingVersion },
    });
    catalogStoreMocks.promoteRegisterCatalogVersion.mockImplementation(
      () => new Promise((resolve) => (resolvePromotion = resolve)),
    );

    const { result } = renderHook(() =>
      useConvexRegisterCatalogState({
        registerRefresh: {
          isOperationallyIdle: true,
          isOperationallyIdleNow: () =>
            !hasRegisterCatalogRuntimeActionGuard({
              storeId: "store-1",
              terminalId: "terminal-1",
            }),
          terminalId: "terminal-1",
        },
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() =>
      expect(
        catalogStoreMocks.promoteRegisterCatalogVersion,
      ).toHaveBeenCalled(),
    );
    expect(
      captureRegisterCatalogRuntimePin({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toMatchObject({ revision: 1, rows: priorRows });
    resolvePromotion({
      ok: true,
      value: { revision: 2, status: "promoted", version: incomingVersion },
    });

    await waitFor(() =>
      expect(result.current.catalogRefreshStatus).toBe("waiting-busy"),
    );
    expect(result.current.rows).toEqual(priorRows);
    clearRegisterCatalogRuntimeActionGuard({
      storeId: "store-1",
      terminalId: "terminal-1",
    });
  });

  it("pauses authorization failures without hot-looping until scope changes", async () => {
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-TRUSTED" })];
    const priorVersion = {
      persistedAt: 1_000,
      revision: 1,
      rows: priorRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    convexMocks.useQuery.mockReturnValue({ revision: 2, status: "ready" });
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-AUTHORIZED" })];
    const refreshedVersion = {
      ...priorVersion,
      revision: 2,
      rows: refreshedRows,
    };
    convexMocks.query
      .mockRejectedValueOnce(new Error("Permission denied"))
      .mockResolvedValueOnce({ revision: 2, rows: refreshedRows });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: priorVersion,
    });

    catalogStoreMocks.stageRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "staged", version: refreshedVersion },
    });
    catalogStoreMocks.promoteRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "promoted", version: refreshedVersion },
    });

    const { result, rerender } = renderHook(
      ({ authScopeKey }) =>
        useConvexRegisterCatalogState({
          registerRefresh: {
            authScopeKey,
            isOperationallyIdle: true,
            terminalId: "terminal-1",
          },
          storeId: "store-1" as Id<"store">,
        }),
      { initialProps: { authScopeKey: "user-1:1" } },
    );

    await waitFor(() =>
      expect(result.current.catalogRefreshStatus).toBe("authorization-paused"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(convexMocks.query).toHaveBeenCalledTimes(1);
    expect(result.current.rows).toEqual(priorRows);

    rerender({ authScopeKey: "user-1:2" });

    await waitFor(() =>
      expect(result.current).toMatchObject({
        catalogRefreshStatus: "current",
        rows: refreshedRows,
      }),
    );
    expect(convexMocks.query).toHaveBeenCalledTimes(2);
  });

  it("cancels transient retry backoff when the auth scope changes", async () => {
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-TRUSTED" })];
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-RECOVERED" })];
    const priorVersion = {
      persistedAt: 1_000,
      revision: 1,
      rows: priorRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    const refreshedVersion = {
      ...priorVersion,
      revision: 2,
      rows: refreshedRows,
    };
    convexMocks.useQuery.mockReturnValue({ revision: 2, status: "ready" });
    convexMocks.query
      .mockRejectedValueOnce(new Error("Temporary service failure"))
      .mockResolvedValueOnce({ revision: 2, rows: refreshedRows });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: priorVersion,
    });
    catalogStoreMocks.stageRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "staged", version: refreshedVersion },
    });
    catalogStoreMocks.promoteRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "promoted", version: refreshedVersion },
    });

    const { result, rerender } = renderHook(
      ({ authScopeKey }) =>
        useConvexRegisterCatalogState({
          registerRefresh: {
            authScopeKey,
            isOperationallyIdle: true,
            terminalId: "terminal-1",
          },
          storeId: "store-1" as Id<"store">,
        }),
      { initialProps: { authScopeKey: "user-1:1" } },
    );

    await waitFor(() =>
      expect(result.current.catalogRefreshStatus).toBe("retry-delayed"),
    );
    expect(convexMocks.query).toHaveBeenCalledTimes(1);

    rerender({ authScopeKey: "user-1:2" });

    await waitFor(() =>
      expect(result.current).toMatchObject({
        catalogRefreshStatus: "current",
        rows: refreshedRows,
      }),
    );
    expect(convexMocks.query).toHaveBeenCalledTimes(2);
  });

  it("starts the new auth scope while the prior scope snapshot is still pending", async () => {
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-PRIOR" })];
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-NEW-SCOPE" })];
    const priorVersion = {
      persistedAt: 1_000,
      revision: 1,
      rows: priorRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    const refreshedVersion = {
      ...priorVersion,
      revision: 2,
      rows: refreshedRows,
    };
    const pendingOldScope = new Promise<never>(() => undefined);
    convexMocks.useQuery.mockReturnValue({ revision: 2, status: "ready" });
    convexMocks.query
      .mockReturnValueOnce(pendingOldScope)
      .mockResolvedValueOnce({ revision: 2, rows: refreshedRows });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: priorVersion,
    });
    catalogStoreMocks.stageRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "staged", version: refreshedVersion },
    });
    catalogStoreMocks.promoteRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "promoted", version: refreshedVersion },
    });

    const { result, rerender } = renderHook(
      ({ authScopeKey }) =>
        useConvexRegisterCatalogState({
          registerRefresh: {
            authScopeKey,
            isOperationallyIdle: true,
            terminalId: "terminal-1",
          },
          storeId: "store-1" as Id<"store">,
        }),
      { initialProps: { authScopeKey: "user-1:1" } },
    );

    await waitFor(() => expect(convexMocks.query).toHaveBeenCalledTimes(1));
    rerender({ authScopeKey: "user-1:2" });

    await waitFor(() =>
      expect(result.current).toMatchObject({
        catalogRefreshStatus: "current",
        rows: refreshedRows,
      }),
    );
    expect(convexMocks.query).toHaveBeenCalledTimes(2);
  });

  it("rejects an old completion after returning through an A-B-A scope sequence", async () => {
    const priorRows = [buildRegisterCatalogRow({ sku: "DW-PRIOR" })];
    const staleRows = [buildRegisterCatalogRow({ sku: "DW-STALE-A" })];
    const currentRows = [buildRegisterCatalogRow({ sku: "DW-CURRENT-A" })];
    const priorVersion = {
      persistedAt: 1_000,
      revision: 1,
      rows: priorRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    const currentVersion = {
      ...priorVersion,
      revision: 2,
      rows: currentRows,
    };
    let resolveOldA!: (value: { revision: number; rows: PosRegisterCatalogRowDto[] }) => void;
    const oldA = new Promise<{ revision: number; rows: PosRegisterCatalogRowDto[] }>(
      (resolve) => (resolveOldA = resolve),
    );
    const pendingB = new Promise<never>(() => undefined);
    convexMocks.useQuery.mockReturnValue({ revision: 2, status: "ready" });
    convexMocks.query
      .mockReturnValueOnce(oldA)
      .mockReturnValueOnce(pendingB)
      .mockResolvedValueOnce({ revision: 2, rows: currentRows });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: priorVersion,
    });
    catalogStoreMocks.stageRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "staged", version: currentVersion },
    });
    catalogStoreMocks.promoteRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "promoted", version: currentVersion },
    });

    const { result, rerender } = renderHook(
      ({ authScopeKey }) =>
        useConvexRegisterCatalogState({
          registerRefresh: {
            authScopeKey,
            isOperationallyIdle: true,
            terminalId: "terminal-1",
          },
          storeId: "store-1" as Id<"store">,
        }),
      { initialProps: { authScopeKey: "scope-a" } },
    );

    await waitFor(() => expect(convexMocks.query).toHaveBeenCalledTimes(1));
    rerender({ authScopeKey: "scope-b" });
    await waitFor(() => expect(convexMocks.query).toHaveBeenCalledTimes(2));
    rerender({ authScopeKey: "scope-a" });
    await waitFor(() => expect(convexMocks.query).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.rows).toEqual(currentRows));

    await act(async () => {
      resolveOldA({ revision: 1, rows: staleRows });
      await Promise.resolve();
    });
    expect(catalogStoreMocks.stageRegisterCatalogVersion).not.toHaveBeenCalledWith(
      expect.objectContaining({ rows: staleRows }),
    );
    expect(result.current.rows).toEqual(currentRows);
  });

  it("projects reactive authorization pause and resumes in the same scope when access returns", async () => {
    let revisionSignal:
      | { status: "authorization-paused" }
      | { revision: number; status: "ready" } = {
      status: "authorization-paused",
    };
    const trustedRows = [buildRegisterCatalogRow({ sku: "DW-TRUSTED" })];
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-RESTORED" })];
    const refreshedVersion = {
      persistedAt: 2_000,
      revision: 2,
      rows: refreshedRows,
      schemaVersion: 9,
      storeId: "store-1",
    };
    convexMocks.useQuery.mockImplementation(() => revisionSignal);
    convexMocks.query.mockResolvedValue({ revision: 2, rows: refreshedRows });
    catalogStoreMocks.readRegisterCatalogSelection.mockResolvedValue({
      ok: true,
      value: {
        persistedAt: 1_000,
        revision: 1,
        rows: trustedRows,
        schemaVersion: 9,
        storeId: "store-1",
      },
    });
    catalogStoreMocks.stageRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "staged", version: refreshedVersion },
    });
    catalogStoreMocks.promoteRegisterCatalogVersion.mockResolvedValue({
      ok: true,
      value: { revision: 2, status: "promoted", version: refreshedVersion },
    });

    const { result, rerender } = renderHook(() =>
      useConvexRegisterCatalogState({
        registerRefresh: {
          authScopeKey: "user-1:1",
          isOperationallyIdle: true,
          terminalId: "terminal-1",
        },
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() =>
      expect(result.current.catalogRefreshStatus).toBe("authorization-paused"),
    );
    expect(convexMocks.query).not.toHaveBeenCalled();

    revisionSignal = { revision: 2, status: "ready" };
    rerender();

    await waitFor(() =>
      expect(result.current).toMatchObject({
        catalogRefreshStatus: "current",
        rows: refreshedRows,
      }),
    );
    expect(convexMocks.query).toHaveBeenCalledTimes(1);
  });

  it("refreshes register catalog metadata once during POS prewarm without a live subscription", async () => {
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-PREWARM" })];
    convexMocks.query.mockResolvedValue(refreshedRows);

    renderHook(() =>
      usePrewarmRegisterCatalogOfflineSnapshots({
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() => expect(convexMocks.query).toHaveBeenCalled());
    expect(
      convexMocks.query.mock.calls.some(
        ([, args]) => args?.storeId === "store-1",
      ),
    ).toBe(true);
    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterCatalogSnapshot,
      ).toHaveBeenCalledWith({
        rows: refreshedRows,
        storeId: "store-1",
      }),
    );
  });

  it("can prewarm POS metadata without refreshing the full availability snapshot", async () => {
    const refreshedRows = [buildRegisterCatalogRow({ sku: "DW-LIGHT" })];
    convexMocks.query.mockResolvedValue(refreshedRows);

    renderHook(() =>
      usePrewarmRegisterCatalogOfflineSnapshots({
        refreshAvailabilitySnapshot: false,
        storeId: "store-1" as Id<"store">,
      }),
    );

    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterCatalogSnapshot,
      ).toHaveBeenCalledWith({
        rows: refreshedRows,
        storeId: "store-1",
      }),
    );
    expect(convexMocks.useQuery).toHaveBeenCalledWith(
      api.pos.public.catalog.listRegisterCatalogAvailabilitySnapshot,
      "skip",
    );
    expect(
      catalogStoreMocks.writeRegisterAvailabilitySnapshot,
    ).not.toHaveBeenCalled();
  });

  it("returns the local service catalog snapshot before live service rows refresh it", async () => {
    const cachedRows = [buildServiceCatalogRow({ name: "Cached Repair" })];
    const liveRows = [buildServiceCatalogRow({ name: "Live Repair" })];
    const liveServiceRows: { current: PosServiceCatalogRowDto[] | undefined } =
      { current: undefined };
    convexMocks.useQuery.mockImplementation((_query, args) => {
      if (args === "skip") return undefined;
      if ("productSkuIds" in args) return liveAvailabilityRows;
      return liveServiceRows.current;
    });
    catalogStoreMocks.readRegisterServiceCatalogSnapshot.mockResolvedValue({
      ok: true,
      value: {
        refreshedAt: 1_700,
        rows: cachedRows,
        schemaVersion: 5,
        storeId: "store-1",
      },
    });
    catalogStoreMocks.writeRegisterServiceCatalogSnapshot.mockImplementation(
      async (input: { rows: PosServiceCatalogRowDto[]; storeId: string }) => ({
        ok: true,
        value: {
          refreshedAt: 1_800,
          rows: input.rows,
          schemaVersion: 5,
          storeId: input.storeId,
        },
      }),
    );

    const { result, rerender } = renderHook(() =>
      useConvexRegisterServiceCatalog({ storeId: "store-1" as Id<"store"> }),
    );

    await waitFor(() => expect(result.current).toEqual(cachedRows));
    liveServiceRows.current = liveRows;
    rerender();
    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterServiceCatalogSnapshot,
      ).toHaveBeenCalledWith({
        storeId: "store-1",
        rows: liveRows,
      }),
    );
    await waitFor(() => expect(result.current).toEqual(liveRows));
  });

  it("refreshes the full local availability snapshot online without changing bounded live rows", async () => {
    liveAvailabilityRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 2,
      }),
    ];
    fullAvailabilitySnapshotRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 2,
      }),
      buildAvailabilityRow({
        productSkuId: "sku-2" as Id<"productSku">,
        skuId: "sku-2" as Id<"productSku">,
        quantityAvailable: 7,
      }),
    ];

    const { result, rerender } = renderHook(() =>
      useConvexRegisterCatalogAvailability({
        refreshFullAvailabilitySnapshot: true,
        storeId: "store-1" as Id<"store">,
        productSkuIds: ["sku-1" as Id<"productSku">],
      }),
    );

    expect(result.current).toEqual([
      expect.objectContaining({
        availabilitySource: "live",
        productSkuId: "sku-1",
      }),
    ]);
    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterAvailabilitySnapshot,
      ).toHaveBeenCalledWith({
        storeId: "store-1",
        rows: fullAvailabilitySnapshotRows,
      }),
    );

    catalogStoreMocks.writeRegisterAvailabilitySnapshot.mockClear();
    fullAvailabilitySnapshotRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 1,
      }),
    ];
    rerender();
    expect(
      catalogStoreMocks.writeRegisterAvailabilitySnapshot,
    ).not.toHaveBeenCalled();
  });

  it("stops the full snapshot refresh when local persistence fails", async () => {
    liveAvailabilityRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 2,
      }),
    ];
    fullAvailabilitySnapshotRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 2,
      }),
    ];
    catalogStoreMocks.writeRegisterAvailabilitySnapshot.mockResolvedValue({
      ok: false,
      error: { code: "write_failed", message: "IndexedDB unavailable" },
    });

    const { result, rerender } = renderHook(() =>
      useConvexRegisterCatalogAvailabilityState({
        refreshFullAvailabilitySnapshot: true,
        storeId: "store-1" as Id<"store">,
        productSkuIds: ["sku-1" as Id<"productSku">],
      }),
    );

    expect(result.current).toEqual({
      status: "ready",
      rows: [
        expect.objectContaining({
          availabilitySource: "live",
          productSkuId: "sku-1",
        }),
      ],
      source: "live",
    });
    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterAvailabilitySnapshot,
      ).toHaveBeenCalledTimes(1),
    );

    catalogStoreMocks.writeRegisterAvailabilitySnapshot.mockClear();
    rerender();

    expect(
      catalogStoreMocks.writeRegisterAvailabilitySnapshot,
    ).not.toHaveBeenCalled();
  });

  it("retries local full snapshot persistence without refetching unchanged live rows", async () => {
    liveAvailabilityRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 2,
      }),
    ];
    fullAvailabilitySnapshotRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 2,
      }),
    ];
    catalogStoreMocks.writeRegisterAvailabilitySnapshot
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "write_failed", message: "IndexedDB unavailable" },
      })
      .mockImplementationOnce(
        async (input: {
          rows: PosRegisterCatalogAvailabilityRowDto[];
          storeId: string;
        }) => ({
          ok: true,
          value: {
            refreshedAt: Date.now(),
            rows: input.rows,
            schemaVersion: 4,
            storeId: input.storeId,
          },
        }),
      );

    const { result } = renderHook(() =>
      useConvexRegisterCatalogAvailabilityState({
        refreshFullAvailabilitySnapshot: true,
        storeId: "store-1" as Id<"store">,
        productSkuIds: ["sku-1" as Id<"productSku">],
      }),
    );

    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterAvailabilitySnapshot,
      ).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(result.current).toEqual({
        status: "ready",
        rows: [
          expect.objectContaining({
            availabilitySource: "live",
            productSkuId: "sku-1",
          }),
        ],
        source: "live",
      }),
    );
  });

  it("keeps bounded availability consumers off the full snapshot refresh path by default", () => {
    liveAvailabilityRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 2,
      }),
    ];
    fullAvailabilitySnapshotRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 2,
      }),
    ];

    const { result } = renderHook(() =>
      useConvexRegisterCatalogAvailability({
        storeId: "store-1" as Id<"store">,
        productSkuIds: ["sku-1" as Id<"productSku">],
      }),
    );

    expect(result.current).toEqual([
      expect.objectContaining({
        availabilitySource: "live",
        productSkuId: "sku-1",
      }),
    ]);
    expect(
      catalogStoreMocks.writeRegisterAvailabilitySnapshot,
    ).not.toHaveBeenCalled();
  });

  it("does not request trusted availability for local pending checkout SKUs", () => {
    renderHook(() =>
      useConvexRegisterCatalogAvailability({
        storeId: "store-1" as Id<"store">,
        productSkuIds: [
          "local-pending-sku-1" as Id<"productSku">,
          "sku-1" as Id<"productSku">,
        ],
      }),
    );

    expect(convexMocks.useQuery).toHaveBeenCalledWith(expect.anything(), {
      storeId: "store-1",
      productSkuIds: ["sku-1"],
    });
  });

  it("refreshes the full local availability snapshot even when no SKU availability is requested", async () => {
    fullAvailabilitySnapshotRows = [
      buildAvailabilityRow({
        productSkuId: "sku-2" as Id<"productSku">,
        skuId: "sku-2" as Id<"productSku">,
        quantityAvailable: 4,
      }),
    ];

    const { result } = renderHook(() =>
      useConvexRegisterCatalogAvailabilityState({
        refreshFullAvailabilitySnapshot: true,
        storeId: "store-1" as Id<"store">,
        productSkuIds: [],
      }),
    );

    expect(result.current).toEqual({
      status: "ready",
      rows: [],
      source: "live",
    });
    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterAvailabilitySnapshot,
      ).toHaveBeenCalledWith({
        storeId: "store-1",
        rows: fullAvailabilitySnapshotRows,
      }),
    );
  });

  it("serves freshly persisted snapshot rows as local fallback without remounting", async () => {
    fullAvailabilitySnapshotRows = [
      buildAvailabilityRow({
        productSkuId: "sku-2" as Id<"productSku">,
        skuId: "sku-2" as Id<"productSku">,
        quantityAvailable: 4,
      }),
    ];

    const { result } = renderHook(() =>
      useConvexRegisterCatalogAvailabilityState({
        refreshFullAvailabilitySnapshot: true,
        storeId: "store-1" as Id<"store">,
        productSkuIds: ["sku-2" as Id<"productSku">],
      }),
    );

    await waitFor(() =>
      expect(
        catalogStoreMocks.writeRegisterAvailabilitySnapshot,
      ).toHaveBeenCalled(),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toEqual({
      status: "ready",
      rows: [
        expect.objectContaining({
          availabilitySource: "local",
          productSkuId: "sku-2",
          quantityAvailable: 4,
        }),
      ],
      source: "local",
    });
  });

  it("resolves offline requested availability from the full local snapshot", async () => {
    catalogStoreMocks.readRegisterAvailabilitySnapshot.mockResolvedValue({
      ok: true,
      value: {
        refreshedAt: Date.now(),
        rows: [
          buildAvailabilityRow({
            productSkuId: "sku-1" as Id<"productSku">,
            skuId: "sku-1" as Id<"productSku">,
            quantityAvailable: 5,
          }),
          buildAvailabilityRow({
            productSkuId: "sku-2" as Id<"productSku">,
            skuId: "sku-2" as Id<"productSku">,
            quantityAvailable: 0,
            inStock: false,
          }),
        ],
        schemaVersion: 4,
        storeId: "store-1",
      },
    });

    const { result } = renderHook(() =>
      useConvexRegisterCatalogAvailabilityState({
        refreshFullAvailabilitySnapshot: true,
        storeId: "store-1" as Id<"store">,
        productSkuIds: [
          "sku-2" as Id<"productSku">,
          "sku-missing" as Id<"productSku">,
        ],
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.rows).toEqual([
      expect.objectContaining({
        availabilitySource: "local",
        productSkuId: "sku-2",
        quantityAvailable: 0,
        inStock: false,
      }),
    ]);
  });

  it("exposes missing and local-store-failure availability states without fabricating rows", async () => {
    const missing = renderHook(() =>
      useConvexRegisterCatalogAvailabilityState({
        storeId: "store-1" as Id<"store">,
        productSkuIds: ["sku-1" as Id<"productSku">],
      }),
    );

    await waitFor(() => expect(missing.result.current.status).toBe("missing"));
    expect(missing.result.current.rows).toBeUndefined();
    missing.unmount();

    catalogStoreMocks.readRegisterAvailabilitySnapshot.mockResolvedValue({
      ok: false,
      error: { code: "write_failed", message: "IndexedDB unavailable" },
    });
    const failed = renderHook(() =>
      useConvexRegisterCatalogAvailabilityState({
        refreshFullAvailabilitySnapshot: true,
        storeId: "store-1" as Id<"store">,
        productSkuIds: ["sku-1" as Id<"productSku">],
      }),
    );

    await waitFor(() =>
      expect(failed.result.current.status).toBe("local-store-failure"),
    );
    expect(failed.result.current.rows).toBeUndefined();
  });

  it("keeps bounded live availability ahead of stale local rows while online", async () => {
    liveAvailabilityRows = [
      buildAvailabilityRow({
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        quantityAvailable: 1,
      }),
    ];
    catalogStoreMocks.readRegisterAvailabilitySnapshot.mockResolvedValue({
      ok: true,
      value: {
        refreshedAt: Date.now(),
        rows: [
          buildAvailabilityRow({
            productSkuId: "sku-1" as Id<"productSku">,
            skuId: "sku-1" as Id<"productSku">,
            quantityAvailable: 9,
          }),
        ],
        schemaVersion: 4,
        storeId: "store-1",
      },
    });

    const { result } = renderHook(() =>
      useConvexRegisterCatalogAvailabilityState({
        storeId: "store-1" as Id<"store">,
        productSkuIds: ["sku-1" as Id<"productSku">],
      }),
    );

    expect(result.current).toEqual({
      status: "ready",
      rows: [
        expect.objectContaining({
          availabilitySource: "live",
          productSkuId: "sku-1",
          quantityAvailable: 1,
        }),
      ],
      source: "live",
    });
  });
});

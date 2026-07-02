import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PosRegisterCatalogAvailabilityRowDto,
  PosRegisterCatalogRowDto,
  PosServiceCatalogRowDto,
} from "@/lib/pos/application/dto";
import type { Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import {
  useConvexRegisterCatalog,
  useConvexRegisterCatalogState,
  useConvexRegisterCatalogAvailability,
  useConvexRegisterCatalogAvailabilityState,
  useConvexRegisterServiceCatalog,
  usePrewarmRegisterCatalogOfflineSnapshots,
} from "./catalogGateway";

const catalogStoreMocks = vi.hoisted(() => ({
  readRegisterAvailabilitySnapshot: vi.fn(),
  readRegisterCatalogSnapshot: vi.fn(),
  readRegisterServiceCatalogSnapshot: vi.fn(),
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

vi.mock("@/lib/pos/infrastructure/local/posLocalStore", () => ({
  createIndexedDbPosLocalStorageAdapter: vi.fn(() => ({})),
  createPosLocalStore: vi.fn(() => catalogStoreMocks),
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
    | PosRegisterCatalogAvailabilityRowDto[]
    | undefined;

  beforeEach(() => {
    liveAvailabilityRows = undefined;
    fullAvailabilitySnapshotRows = undefined;
    convexMocks.query.mockReset();
    convexMocks.query.mockResolvedValue([]);
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
    catalogStoreMocks.readRegisterServiceCatalogSnapshot.mockReset();
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
    catalogStoreMocks.readRegisterServiceCatalogSnapshot.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.writeRegisterAvailabilitySnapshot.mockImplementation(
      async (input: { rows: PosRegisterCatalogAvailabilityRowDto[]; storeId: string }) => ({
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
    expect(convexMocks.useQuery).not.toHaveBeenCalled();
    expect(convexMocks.query).not.toHaveBeenCalled();
    expect(catalogStoreMocks.readRegisterCatalogSnapshot).toHaveBeenCalledWith({
      storeId: "store-1",
    });
    expect(catalogStoreMocks.writeRegisterCatalogSnapshot).not.toHaveBeenCalled();
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
    expect(convexMocks.useQuery).not.toHaveBeenCalled();
    expect(convexMocks.query).not.toHaveBeenCalled();
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
    expect(convexMocks.useQuery).not.toHaveBeenCalled();
    expect(convexMocks.query).toHaveBeenCalledWith(expect.anything(), {
      storeId: "store-1",
    });
    await waitFor(() =>
      expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledWith({
        storeId: "store-1",
        rows: refreshedRows,
      }),
    );
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
      expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledWith({
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
      expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledWith({
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
      expect(catalogStoreMocks.writeRegisterServiceCatalogSnapshot).toHaveBeenCalledWith({
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
    expect(catalogStoreMocks.writeRegisterAvailabilitySnapshot).not.toHaveBeenCalled();
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

    expect(catalogStoreMocks.writeRegisterAvailabilitySnapshot).not.toHaveBeenCalled();
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
    expect(catalogStoreMocks.writeRegisterAvailabilitySnapshot).not.toHaveBeenCalled();
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

    expect(convexMocks.useQuery).toHaveBeenCalledWith(
      expect.anything(),
      {
        storeId: "store-1",
        productSkuIds: ["sku-1"],
      },
    );
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
      expect(catalogStoreMocks.writeRegisterAvailabilitySnapshot).toHaveBeenCalled(),
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

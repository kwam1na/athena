import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PosRegisterCatalogAvailabilityRowDto,
  PosRegisterCatalogRowDto,
} from "@/lib/pos/application/dto";
import type { Id } from "~/convex/_generated/dataModel";
import {
  useConvexRegisterCatalog,
  useConvexRegisterCatalogAvailability,
  useConvexRegisterCatalogAvailabilityState,
} from "./catalogGateway";

const catalogStoreMocks = vi.hoisted(() => ({
  readRegisterAvailabilitySnapshot: vi.fn(),
  readRegisterCatalogSnapshot: vi.fn(),
  writeRegisterAvailabilitySnapshot: vi.fn(),
  writeRegisterCatalogSnapshot: vi.fn(),
}));
const convexMocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
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

describe("catalogGateway", () => {
  let liveAvailabilityRows: PosRegisterCatalogAvailabilityRowDto[] | undefined;
  let fullAvailabilitySnapshotRows:
    | PosRegisterCatalogAvailabilityRowDto[]
    | undefined;

  beforeEach(() => {
    liveAvailabilityRows = undefined;
    fullAvailabilitySnapshotRows = undefined;
    convexMocks.useMutation.mockReset();
    convexMocks.useQuery.mockReset();
    convexMocks.useQuery.mockImplementation((_query, args) => {
      if (args === "skip") return undefined;
      if ("productSkuIds" in args) return liveAvailabilityRows;
      return fullAvailabilitySnapshotRows;
    });
    catalogStoreMocks.readRegisterAvailabilitySnapshot.mockReset();
    catalogStoreMocks.readRegisterCatalogSnapshot.mockReset();
    catalogStoreMocks.writeRegisterAvailabilitySnapshot.mockReset();
    catalogStoreMocks.writeRegisterCatalogSnapshot.mockReset();
    catalogStoreMocks.readRegisterAvailabilitySnapshot.mockResolvedValue({
      ok: true,
      value: null,
    });
    catalogStoreMocks.readRegisterCatalogSnapshot.mockResolvedValue({
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
    catalogStoreMocks.writeRegisterCatalogSnapshot.mockResolvedValue({
      ok: true,
      value: null,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {} as IDBFactory,
    });
  });

  it("returns the cached register catalog snapshot while live catalog data is unavailable", async () => {
    const cachedRows = [buildRegisterCatalogRow()];
    convexMocks.useQuery.mockReturnValue(undefined);
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
    expect(catalogStoreMocks.readRegisterCatalogSnapshot).toHaveBeenCalledWith({
      storeId: "store-1",
    });
    expect(catalogStoreMocks.writeRegisterCatalogSnapshot).not.toHaveBeenCalled();
  });

  it("keeps the register catalog loading when neither live data nor a local snapshot is available", async () => {
    convexMocks.useQuery.mockReturnValue(undefined);
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
  });

  it("persists live register catalog rows for the next offline lookup", async () => {
    const liveRows = [buildRegisterCatalogRow({ sku: "DW-20" })];
    convexMocks.useQuery.mockReturnValue(liveRows);

    const { result } = renderHook(() =>
      useConvexRegisterCatalog({ storeId: "store-1" as Id<"store"> }),
    );

    expect(result.current).toEqual(liveRows);
    await waitFor(() =>
      expect(catalogStoreMocks.writeRegisterCatalogSnapshot).toHaveBeenCalledWith({
        storeId: "store-1",
        rows: liveRows,
      }),
    );
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

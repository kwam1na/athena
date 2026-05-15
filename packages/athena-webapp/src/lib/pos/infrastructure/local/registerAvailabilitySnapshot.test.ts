import { describe, expect, it } from "vitest";

import type { PosRegisterCatalogAvailabilityRowDto } from "@/lib/pos/application/dto";
import {
  POS_LOCAL_STORE_SCHEMA_VERSION,
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";
import { readRegisterAvailabilitySnapshotState } from "./registerAvailabilitySnapshot";

function buildAvailabilityRow(
  overrides: Partial<PosRegisterCatalogAvailabilityRowDto> = {},
): PosRegisterCatalogAvailabilityRowDto {
  return {
    productSkuId: "sku-1" as never,
    skuId: "sku-1" as never,
    inStock: true,
    quantityAvailable: 5,
    ...overrides,
  };
}

describe("registerAvailabilitySnapshot", () => {
  it("returns ready for a fresh snapshot, including an intentionally empty snapshot", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_000,
    });
    await store.writeRegisterAvailabilitySnapshot({
      storeId: "store-1",
      rows: [],
    });

    await expect(
      readRegisterAvailabilitySnapshotState({
        store,
        storeId: "store-1",
        now: 1_500,
      }),
    ).resolves.toEqual({
      status: "ready",
      snapshot: {
        refreshedAt: 1_000,
        rows: [],
        schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
        storeId: "store-1",
      },
    });
  });

  it("returns missing when no snapshot has been written", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });

    await expect(
      readRegisterAvailabilitySnapshotState({
        store,
        storeId: "store-1",
      }),
    ).resolves.toEqual({ status: "missing", snapshot: null });
  });

  it("returns stale when the snapshot age exceeds the readiness window", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_000,
    });
    await store.writeRegisterAvailabilitySnapshot({
      storeId: "store-1",
      rows: [buildAvailabilityRow()],
    });

    await expect(
      readRegisterAvailabilitySnapshotState({
        store,
        storeId: "store-1",
        maxAgeMs: 499,
        now: 1_500,
      }),
    ).resolves.toEqual({
      status: "stale",
      snapshot: expect.objectContaining({
        refreshedAt: 1_000,
        rows: [expect.objectContaining({ productSkuId: "sku-1" })],
      }),
    });
  });

  it("returns local-store-failure for unsupported schemas and read errors", async () => {
    const unsupportedStore = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter({
        schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION + 1,
      }),
    });

    await expect(
      readRegisterAvailabilitySnapshotState({
        store: unsupportedStore,
        storeId: "store-1",
      }),
    ).resolves.toMatchObject({
      status: "local-store-failure",
      error: { code: "unsupported_schema_version" },
      snapshot: null,
    });
  });
});

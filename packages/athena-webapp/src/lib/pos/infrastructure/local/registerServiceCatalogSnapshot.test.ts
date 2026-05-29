import { describe, expect, it } from "vitest";

import {
  POS_LOCAL_STORE_SCHEMA_VERSION,
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";
import { readRegisterServiceCatalogSnapshotState } from "./registerServiceCatalogSnapshot";

function buildServiceCatalogRow() {
  return {
    serviceCatalogId: "service-1" as never,
    name: "Closure Repair",
    description: "Repair a closure install",
    serviceMode: "repair" as const,
    pricingModel: "fixed" as const,
    basePrice: 4_500,
    depositType: "none" as const,
    requiresManagerApproval: false,
    status: "active" as const,
    updatedAt: 1_000,
    checkoutReadiness: {
      canCheckoutDirectly: true as const,
      message: "Ready for checkout.",
      reason: "fixed_price" as const,
      status: "ready" as const,
      suggestedAmount: 4_500,
    },
  };
}

describe("registerServiceCatalogSnapshot", () => {
  it("marks a fresh service catalog snapshot ready", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_000,
    });
    await store.writeRegisterServiceCatalogSnapshot({
      storeId: "store-1",
      rows: [buildServiceCatalogRow()],
    });

    await expect(
      readRegisterServiceCatalogSnapshotState({
        now: 1_500,
        store,
        storeId: "store-1",
      }),
    ).resolves.toEqual({
      status: "ready",
      snapshot: expect.objectContaining({
        refreshedAt: 1_000,
        rows: [expect.objectContaining({ serviceCatalogId: "service-1" })],
      }),
    });
  });

  it("marks stale service catalog snapshots usable", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_000,
    });
    await store.writeRegisterServiceCatalogSnapshot({
      storeId: "store-1",
      rows: [buildServiceCatalogRow()],
    });

    await expect(
      readRegisterServiceCatalogSnapshotState({
        maxAgeMs: 100,
        now: 1_500,
        store,
        storeId: "store-1",
      }),
    ).resolves.toEqual({
      status: "stale",
      snapshot: expect.objectContaining({
        rows: [expect.objectContaining({ serviceCatalogId: "service-1" })],
      }),
    });
  });

  it("reports missing and local-store failures separately", async () => {
    const missingStore = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await expect(
      readRegisterServiceCatalogSnapshotState({
        store: missingStore,
        storeId: "store-1",
      }),
    ).resolves.toEqual({ status: "missing", snapshot: null });

    const unsupportedStore = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter({
        schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION + 1,
      }),
    });
    await expect(
      readRegisterServiceCatalogSnapshotState({
        store: unsupportedStore,
        storeId: "store-1",
      }),
    ).resolves.toMatchObject({
      status: "local-store-failure",
      snapshot: null,
      error: { code: "unsupported_schema_version" },
    });
  });
});

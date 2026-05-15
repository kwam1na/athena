import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";

const mocks = vi.hoisted(() => ({
  listRegisterCatalogAvailabilitySnapshot: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../application/queries/listRegisterCatalog", () => ({
  REGISTER_CATALOG_AVAILABILITY_LIMIT: 50,
  listRegisterCatalog: vi.fn(),
  listRegisterCatalogAvailability: vi.fn(),
  listRegisterCatalogAvailabilitySnapshot:
    mocks.listRegisterCatalogAvailabilitySnapshot,
}));

vi.mock("../application/queries/searchCatalog", () => ({
  lookupByBarcode: vi.fn(),
  searchProducts: vi.fn(),
}));

vi.mock("../application/commands/quickAddCatalogItem", () => ({
  quickAddCatalogItem: vi.fn(),
}));

import {
  listRegisterCatalogAvailability,
  listRegisterCatalogAvailabilitySnapshot,
} from "./catalog";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("POS public catalog queries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
    mocks.listRegisterCatalogAvailabilitySnapshot.mockResolvedValue([
      {
        productSkuId: "sku-1",
        skuId: "sku-1",
        inStock: true,
        quantityAvailable: 3,
      },
    ]);
  });

  it("requires same-organization POS access before returning full-store availability", async () => {
    const ctx = buildCtx();

    const rows = await getHandler(listRegisterCatalogAvailabilitySnapshot)(
      ctx as never,
      { storeId: "store-1" },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        productSkuId: "sku-1",
        quantityAvailable: 3,
      }),
    ]);
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(ctx);
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage:
        "You cannot view register catalog availability for this store.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
    expect(mocks.listRegisterCatalogAvailabilitySnapshot).toHaveBeenCalledWith(
      ctx,
      { storeId: "store-1" },
    );
  });

  it("requires same-organization POS access before returning bounded availability", async () => {
    mocks.listRegisterCatalogAvailabilitySnapshot.mockResolvedValue([]);
    const readRegisterCatalogAvailability = await import(
      "../application/queries/listRegisterCatalog"
    );
    vi.mocked(
      readRegisterCatalogAvailability.listRegisterCatalogAvailability,
    ).mockResolvedValue([
      {
        productSkuId: "sku-1" as Id<"productSku">,
        skuId: "sku-1" as Id<"productSku">,
        inStock: true,
        quantityAvailable: 3,
      },
    ]);
    const ctx = buildCtx();

    const rows = await getHandler(listRegisterCatalogAvailability)(ctx as never, {
      storeId: "store-1",
      productSkuIds: ["sku-1"],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        productSkuId: "sku-1",
        quantityAvailable: 3,
      }),
    ]);
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage:
        "You cannot view register catalog availability for this store.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
    expect(
      readRegisterCatalogAvailability.listRegisterCatalogAvailability,
    ).toHaveBeenCalledWith(ctx, {
      storeId: "store-1",
      productSkuIds: ["sku-1"],
    });
  });

  it("does not return full-store availability when the caller is unauthenticated", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("Sign in again to continue."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(listRegisterCatalogAvailabilitySnapshot)(ctx as never, {
        storeId: "store-1",
      }),
    ).rejects.toThrow("Sign in again to continue.");

    expect(mocks.listRegisterCatalogAvailabilitySnapshot).not.toHaveBeenCalled();
  });

  it("does not return bounded availability when the caller is unauthenticated", async () => {
    const readRegisterCatalogAvailability = await import(
      "../application/queries/listRegisterCatalog"
    );
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("Sign in again to continue."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(listRegisterCatalogAvailability)(ctx as never, {
        storeId: "store-1",
        productSkuIds: ["sku-1"],
      }),
    ).rejects.toThrow("Sign in again to continue.");

    expect(
      readRegisterCatalogAvailability.listRegisterCatalogAvailability,
    ).not.toHaveBeenCalled();
  });
});

function buildCtx() {
  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "store" && id === "store-1") {
          return {
            _id: "store-1",
            organizationId: "org-1",
          };
        }

        return null;
      }),
    },
  };
}

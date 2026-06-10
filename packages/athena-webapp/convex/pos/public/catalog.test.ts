import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";

const mocks = vi.hoisted(() => ({
  createOrReusePendingCheckoutItem: vi.fn(),
  findStoreSkuByBarcode: vi.fn(),
  listRegisterCatalogAvailabilitySnapshot: vi.fn(),
  quickAddCatalogItem: vi.fn(),
  recordOperationalEventWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  updateOperationalWorkItemStatusWithCtx: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../application/queries/listRegisterCatalog", () => ({
  REGISTER_CATALOG_AVAILABILITY_LIMIT: 50,
  isTrustedRegisterCatalogSku: vi.fn(
    ({ product, sku }) =>
      product.availability !== "archived" &&
      product.availability !== "draft" &&
      product.isVisible !== false &&
      sku.isVisible !== false,
  ),
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
  quickAddCatalogItem: mocks.quickAddCatalogItem,
}));

vi.mock("../application/commands/createOrReusePendingCheckoutItem", () => ({
  createOrReusePendingCheckoutItem: mocks.createOrReusePendingCheckoutItem,
}));

vi.mock("../../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: mocks.recordOperationalEventWithCtx,
}));

vi.mock("../../operations/operationalWorkItems", () => ({
  updateOperationalWorkItemStatusWithCtx:
    mocks.updateOperationalWorkItemStatusWithCtx,
}));

vi.mock("../infrastructure/repositories/catalogRepository", () => ({
  findStoreSkuByBarcode: mocks.findStoreSkuByBarcode,
}));

import {
  createOrReusePendingCheckoutItemForSale,
  listPendingCheckoutItemsForReview,
  listRegisterCatalogSnapshot,
  listRegisterCatalogAvailability,
  listRegisterCatalogAvailabilitySnapshot,
  quickAddSku,
  resolvePendingCheckoutItemReview,
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
    mocks.createOrReusePendingCheckoutItem.mockResolvedValue({
      id: "pending-1",
      lookupCode: "123456789012",
      name: "Missing item",
      pendingCheckoutItemId: "pending-1",
      price: 12000,
      productId: "product-1",
      productSkuId: "sku-1",
      quantitySold: 1,
      reviewPriority: "normal",
      sku: "PENDING-1",
      status: "pending_review",
    });
    mocks.findStoreSkuByBarcode.mockResolvedValue(null);
    mocks.quickAddCatalogItem.mockResolvedValue({
      areProcessingFeesAbsorbed: false,
      barcode: "123456789012",
      category: "Quick add",
      color: "",
      description: "",
      id: "sku-1",
      image: null,
      inStock: true,
      length: null,
      name: "Quick item",
      price: 12000,
      productId: "product-1",
      quantityAvailable: 1,
      size: "",
      sku: "SKU-1",
      skuId: "sku-1",
    });
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

  it("requires same-organization POS access before returning the full register catalog snapshot", async () => {
    const readRegisterCatalog = await import(
      "../application/queries/listRegisterCatalog"
    );
    vi.mocked(readRegisterCatalog.listRegisterCatalog).mockResolvedValue([
      {
        areProcessingFeesAbsorbed: false,
        availabilityPolicy: "active_provisional_import",
        barcode: "123456789012",
        category: "Import",
        color: "",
        description: "",
        id: "sku-1" as Id<"productSku">,
        image: null,
        inventoryImportProvisionalSkuId:
          "provisional-1" as Id<"inventoryImportProvisionalSku">,
        length: null,
        name: "Legacy import",
        price: 12000,
        productId: "product-1" as Id<"product">,
        productSkuId: "sku-1" as Id<"productSku">,
        size: "",
        sku: "LEGACY-1",
        skuId: "sku-1" as Id<"productSku">,
      },
    ]);
    const ctx = buildCtx();

    const rows = await getHandler(listRegisterCatalogSnapshot)(ctx as never, {
      storeId: "store-1",
    });

    expect(rows).toEqual([
      expect.objectContaining({
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId: "provisional-1",
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
    expect(readRegisterCatalog.listRegisterCatalog).toHaveBeenCalledWith(ctx, {
      storeId: "store-1",
    });
  });

  it("does not return the register catalog snapshot when the caller is unauthenticated", async () => {
    const readRegisterCatalog = await import(
      "../application/queries/listRegisterCatalog"
    );
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("Sign in again to continue."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(listRegisterCatalogSnapshot)(ctx as never, {
        storeId: "store-1",
      }),
    ).rejects.toThrow("Sign in again to continue.");

    expect(readRegisterCatalog.listRegisterCatalog).not.toHaveBeenCalled();
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
        availabilityPolicy: "trusted_inventory",
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

  it("derives the quick-add actor from auth before writing catalog stock", async () => {
    const ctx = buildCtx();

    await getHandler(quickAddSku)(ctx as never, {
      createdByUserId: "forged-user",
      lookupCode: "123456789012",
      name: "Quick item",
      price: 12000,
      quantityAvailable: 1,
      storeId: "store-1",
    });

    expect(mocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(ctx);
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot quick add products for this store.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
    expect(mocks.quickAddCatalogItem).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        createdByUserId: "athena-user-1",
        storeId: "store-1",
      }),
    );
  });

  it("does not quick-add catalog stock when store authorization fails", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("You cannot quick add products for this store."),
    );

    await expect(
      getHandler(quickAddSku)(buildCtx() as never, {
        createdByUserId: "forged-user",
        name: "Quick item",
        price: 12000,
        quantityAvailable: 1,
        storeId: "store-1",
      }),
    ).rejects.toThrow("You cannot quick add products for this store.");

    expect(mocks.quickAddCatalogItem).not.toHaveBeenCalled();
  });

  it("derives the actor from auth before creating a pending checkout item", async () => {
    const ctx = buildCtx();

    const result = await getHandler(createOrReusePendingCheckoutItemForSale)(
      ctx as never,
      {
        createdByStaffProfileId: "staff-1",
        lookupCode: "123456789012",
        name: "Missing item",
        price: 12000,
        quantitySold: 1,
        registerSessionId: "register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    );

    expect(result).toMatchObject({
      pendingCheckoutItemId: "pending-1",
      status: "pending_review",
    });
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(ctx);
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage:
        "You cannot add pending checkout items for this store.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
    expect(mocks.createOrReusePendingCheckoutItem).toHaveBeenCalledWith(ctx, {
      createdByStaffProfileId: "staff-1",
      createdByUserId: "athena-user-1",
      lookupCode: "123456789012",
      name: "Missing item",
      price: 12000,
      quantitySold: 1,
      registerSessionId: "register-1",
      source: "online",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
  });

  it("accepts active register sessions for pending checkout creation", async () => {
    const ctx = buildCtx({
      registerSession: {
        _id: "register-1",
        openedByStaffProfileId: "staff-1",
        storeId: "store-1",
        status: "active",
        terminalId: "terminal-1",
      },
      staffProfile: {
        _id: "staff-1",
        status: "active",
        storeId: "store-1",
      },
      terminal: {
        _id: "terminal-1",
        status: "active",
        storeId: "store-1",
      },
    });

    await getHandler(createOrReusePendingCheckoutItemForSale)(ctx as never, {
      createdByStaffProfileId: "staff-1",
      name: "Missing item",
      price: 12000,
      quantitySold: 1,
      registerSessionId: "register-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(mocks.createOrReusePendingCheckoutItem).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        createdByStaffProfileId: "staff-1",
        registerSessionId: "register-1",
        terminalId: "terminal-1",
      }),
    );
  });

  it("rejects forged pending checkout context from another store", async () => {
    const ctx = buildCtx({
      staffProfile: {
        _id: "staff-foreign",
        status: "active",
        storeId: "store-2",
      },
    });

    await expect(
      getHandler(createOrReusePendingCheckoutItemForSale)(ctx as never, {
        createdByStaffProfileId: "staff-foreign",
        name: "Missing item",
        price: 12000,
        quantitySold: 1,
        registerSessionId: "register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).rejects.toThrow("Active staff context is required");

    expect(mocks.createOrReusePendingCheckoutItem).not.toHaveBeenCalled();
  });

  it("rejects pending checkout staff attribution that does not match the open register session", async () => {
    const ctx = buildCtx({
      registerSession: {
        _id: "register-1",
        openedByStaffProfileId: "staff-other",
        status: "open",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    });

    await expect(
      getHandler(createOrReusePendingCheckoutItemForSale)(ctx as never, {
        createdByStaffProfileId: "staff-1",
        name: "Missing item",
        price: 12000,
        quantitySold: 1,
        registerSessionId: "register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).rejects.toThrow(
      "The active register session does not match this staff member.",
    );

    expect(mocks.createOrReusePendingCheckoutItem).not.toHaveBeenCalled();
  });

  it("does not list pending checkout review items when manager authorization fails", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("You cannot review pending checkout items for this store."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(listPendingCheckoutItemsForReview)(ctx as never, {
        storeId: "store-1",
      }),
    ).rejects.toThrow("You cannot review pending checkout items for this store.");

    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("does not resolve pending checkout review items when manager authorization fails", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("You cannot resolve pending checkout items for this store."),
    );
    const ctx = buildCtx({
      pendingCheckoutItem: {
        _id: "pending-1",
        evidence: {
          observedLookupCodes: ["123"],
          observedPrices: [12000],
          totalQuantitySold: 1,
          transactionCount: 1,
        },
        name: "Missing item",
        provisionalPrice: 12000,
        reviewPriority: "normal",
        status: "pending_review",
        storeId: "store-1",
        updatedAt: 1,
      },
    });

    await expect(
      getHandler(resolvePendingCheckoutItemReview)(ctx as never, {
        pendingCheckoutItemId: "pending-1",
        status: "flagged",
        storeId: "store-1",
      }),
    ).rejects.toThrow("You cannot resolve pending checkout items for this store.");

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(mocks.findStoreSkuByBarcode).not.toHaveBeenCalled();
    expect(mocks.updateOperationalWorkItemStatusWithCtx).not.toHaveBeenCalled();
    expect(mocks.recordOperationalEventWithCtx).not.toHaveBeenCalled();
  });

  it("requires a real catalog link before approving pending checkout review", async () => {
    const ctx = buildCtx({
      pendingCheckoutItem: {
        _id: "pending-1",
        evidence: {
          observedLookupCodes: ["123"],
          observedPrices: [12000],
          totalQuantitySold: 1,
          transactionCount: 1,
        },
        name: "Missing item",
        provisionalPrice: 12000,
        reviewPriority: "normal",
        status: "pending_review",
        storeId: "store-1",
        updatedAt: 1,
      },
    });

    await expect(
      getHandler(resolvePendingCheckoutItemReview)(ctx as never, {
        pendingCheckoutItemId: "pending-1",
        status: "approved",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Choose a valid catalog product and SKU from this store.");
  });

  it("rejects provisional hidden anchors as pending checkout review links", async () => {
    const ctx = buildCtx({
      pendingCheckoutItem: {
        _id: "pending-1",
        evidence: {
          observedLookupCodes: ["123"],
          observedPrices: [12000],
          totalQuantitySold: 1,
          transactionCount: 1,
        },
        name: "Missing item",
        provisionalPrice: 12000,
        provisionalProductId: "product-provisional-1",
        provisionalProductSkuId: "sku-provisional-1",
        reviewPriority: "normal",
        status: "pending_review",
        storeId: "store-1",
        updatedAt: 1,
      },
      product: {
        _id: "product-provisional-1",
        availability: "draft",
        isVisible: false,
        storeId: "store-1",
      },
      productSku: {
        _id: "sku-provisional-1",
        isVisible: false,
        productId: "product-provisional-1",
        storeId: "store-1",
      },
    });

    await expect(
      getHandler(resolvePendingCheckoutItemReview)(ctx as never, {
        approvedProductId: "product-provisional-1",
        approvedProductSkuId: "sku-provisional-1",
        pendingCheckoutItemId: "pending-1",
        status: "linked_to_catalog",
        storeId: "store-1",
      }),
    ).rejects.toThrow("Choose a valid catalog product and SKU from this store.");
  });

  it("attaches the observed lookup code to a linked trusted SKU when barcode is empty", async () => {
    const ctx = buildCtx({
      pendingCheckoutItem: {
        _id: "pending-1",
        evidence: {
          observedLookupCodes: ["123456789012"],
          observedPrices: [12000],
          totalQuantitySold: 1,
          transactionCount: 1,
        },
        lookupCode: "123456789012",
        name: "Missing item",
        provisionalPrice: 12000,
        reviewPriority: "normal",
        status: "pending_review",
        storeId: "store-1",
        updatedAt: 1,
      },
      product: {
        _id: "product-live-1",
        availability: "live",
        isVisible: true,
        storeId: "store-1",
      },
      productSku: {
        _id: "sku-live-1",
        barcode: "",
        isVisible: true,
        productId: "product-live-1",
        storeId: "store-1",
      },
    });

    await getHandler(resolvePendingCheckoutItemReview)(ctx as never, {
      approvedProductId: "product-live-1",
      approvedProductSkuId: "sku-live-1",
      pendingCheckoutItemId: "pending-1",
      status: "linked_to_catalog",
      storeId: "store-1",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith("productSku", "sku-live-1", {
      barcode: "123456789012",
      barcodeAutoGenerated: false,
    });
    expect(mocks.recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventType: "pos_pending_checkout_item_reviewed",
        metadata: expect.objectContaining({
          approvedProductId: "product-live-1",
          approvedProductSkuId: "sku-live-1",
          attachedLookupCode: "123456789012",
          previousStatus: "pending_review",
          status: "linked_to_catalog",
        }),
      }),
    );
  });

  it("does not attach a pending lookup code that belongs to another SKU", async () => {
    mocks.findStoreSkuByBarcode.mockResolvedValueOnce({
      _id: "sku-other",
      barcode: "123456789012",
      productId: "product-other",
      storeId: "store-1",
    });
    const ctx = buildCtx({
      pendingCheckoutItem: {
        _id: "pending-1",
        evidence: {
          observedLookupCodes: ["123456789012"],
          observedPrices: [12000],
          totalQuantitySold: 1,
          transactionCount: 1,
        },
        lookupCode: "123456789012",
        name: "Missing item",
        provisionalPrice: 12000,
        reviewPriority: "normal",
        status: "pending_review",
        storeId: "store-1",
        updatedAt: 1,
      },
      product: {
        _id: "product-live-1",
        availability: "live",
        isVisible: true,
        storeId: "store-1",
      },
      productSku: {
        _id: "sku-live-1",
        barcode: "",
        isVisible: true,
        productId: "product-live-1",
        storeId: "store-1",
      },
    });

    await expect(
      getHandler(resolvePendingCheckoutItemReview)(ctx as never, {
        approvedProductId: "product-live-1",
        approvedProductSkuId: "sku-live-1",
        pendingCheckoutItemId: "pending-1",
        status: "linked_to_catalog",
        storeId: "store-1",
      }),
    ).rejects.toThrow("This lookup code already belongs to another catalog SKU.");

    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "productSku",
      "sku-live-1",
      expect.anything(),
    );
  });

  it("does not create pending checkout items when the caller is unauthenticated", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("Sign in again to continue."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(createOrReusePendingCheckoutItemForSale)(ctx as never, {
        createdByStaffProfileId: "staff-1",
        name: "Missing item",
        price: 12000,
        quantitySold: 1,
        registerSessionId: "register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).rejects.toThrow("Sign in again to continue.");

    expect(mocks.createOrReusePendingCheckoutItem).not.toHaveBeenCalled();
  });
});

function buildCtx(seed?: {
  pendingCheckoutItem?: Record<string, unknown>;
  product?: Record<string, unknown>;
  productSku?: Record<string, unknown>;
  registerSession?: Record<string, unknown>;
  staffProfile?: Record<string, unknown>;
  terminal?: Record<string, unknown>;
}) {
  const staffProfile = seed?.staffProfile ?? {
    _id: "staff-1",
    status: "active",
    storeId: "store-1",
  };
  const terminal = seed?.terminal ?? {
    _id: "terminal-1",
    status: "active",
    storeId: "store-1",
  };
  const registerSession = seed?.registerSession ?? {
    _id: "register-1",
    openedByStaffProfileId: "staff-1",
    status: "open",
    storeId: "store-1",
    terminalId: "terminal-1",
  };

  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "store" && id === "store-1") {
          return {
            _id: "store-1",
            organizationId: "org-1",
          };
        }
        if (tableName === "staffProfile" && staffProfile?._id === id) {
          return staffProfile;
        }
        if (tableName === "posTerminal" && terminal?._id === id) {
          return terminal;
        }
        if (
          tableName === "registerSession" &&
          registerSession?._id === id
        ) {
          return registerSession;
        }
        if (
          tableName === "posPendingCheckoutItem" &&
          seed?.pendingCheckoutItem?._id === id
        ) {
          return seed.pendingCheckoutItem;
        }
        if (tableName === "product" && seed?.product?._id === id) {
          return seed.product;
        }
        if (tableName === "productSku" && seed?.productSku?._id === id) {
          return seed.productSku;
        }

        return null;
      }),
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          order: vi.fn(() => ({
            take: vi.fn(async () => []),
          })),
        })),
      })),
      patch: vi.fn(),
    },
  };
}

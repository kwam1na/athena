import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";

const mocks = vi.hoisted(() => ({
  advanceRegisterCatalogRevision: vi.fn(),
  applyInventoryEffectWithCtx: vi.fn(),
  createOrReusePendingCheckoutItem: vi.fn(),
  findStoreSkuByBarcode: vi.fn(),
  getServicePrincipalActorWithCtx: vi.fn(),
  refreshCatalogSummaryWithCtx: vi.fn(),
  listRegisterCatalogAvailabilitySnapshot: vi.fn(),
  listRegisterCatalogWithRevision: vi.fn(),
  readRegisterCatalogRevision: vi.fn(),
  lookupByBarcode: vi.fn(),
  quickAddCatalogItem: vi.fn(),
  recordInventoryMovementWithCtx: vi.fn(),
  recordOperationalEventWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserIndexedWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  requirePosApplicationAuthorityWithCtx: vi.fn(),
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
  searchProducts: vi.fn(),
  updateOperationalWorkItemStatusWithCtx: vi.fn(),
  upsertProductSkuSearchProjection: vi.fn(),
}));

vi.mock("../../servicePrincipals/actor", () => ({
  getServicePrincipalActorWithCtx: mocks.getServicePrincipalActorWithCtx,
}));

vi.mock("../application/posApplicationAuthority", () => ({
  requirePosApplicationAuthorityWithCtx:
    mocks.requirePosApplicationAuthorityWithCtx,
}));

vi.mock("../application/sync/registerCatalogRevision", () => ({
  advanceRegisterCatalogRevision: mocks.advanceRegisterCatalogRevision,
  readRegisterCatalogRevision: mocks.readRegisterCatalogRevision,
}));

vi.mock("../../reporting/inventory/effects", () => ({
  applyInventoryEffectWithCtx: mocks.applyInventoryEffectWithCtx,
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserIndexedWithCtx:
    mocks.requireAuthenticatedAthenaUserIndexedWithCtx,
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../../inventory/skuSearch", () => ({
  upsertProductSkuSearchProjection: mocks.upsertProductSkuSearchProjection,
}));

vi.mock("../../sharedDemo/actor", () => ({
  requireSharedDemoStoreCapabilityIfApplicable:
    mocks.requireSharedDemoStoreCapabilityIfApplicable,
}));

vi.mock("../../inventory/catalogSummary", () => ({
  refreshCatalogSummaryWithCtx: mocks.refreshCatalogSummaryWithCtx,
}));

vi.mock("../../operations/inventoryMovements", () => ({
  recordInventoryMovementWithCtx: mocks.recordInventoryMovementWithCtx,
}));

vi.mock("../application/queries/listRegisterCatalog", () => ({
  REGISTER_CATALOG_AVAILABILITY_LIMIT: 50,
  isTrustedRegisterCatalogSku: vi.fn(
    ({ category, product, sku }) =>
      product.availability !== "archived" &&
      product.availability !== "draft" &&
      (product.posVisible !== false || category?.slug === "pos-quick-add") &&
      (sku.posVisible !== false || category?.slug === "pos-quick-add"),
  ),
  listRegisterCatalog: vi.fn(),
  listRegisterCatalogAvailability: vi.fn(),
  listRegisterCatalogAvailabilitySnapshot:
    mocks.listRegisterCatalogAvailabilitySnapshot,
  listRegisterCatalogWithRevision: mocks.listRegisterCatalogWithRevision,
}));

vi.mock("../application/queries/searchCatalog", () => ({
  lookupByBarcode: mocks.lookupByBarcode,
  searchProducts: mocks.searchProducts,
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
  barcodeLookup,
  createOrReusePendingCheckoutItemForSale,
  finalizePendingCheckoutTrustedInventoryFromProductPage,
  listLinkedPendingCheckoutAliasesBySku,
  listLinkedPendingCheckoutProvisionalBindingsBySku,
  listPendingCheckoutItemsForReview,
  listPendingCheckoutProductPageBinding,
  listRegisterCatalogSnapshot,
  listRegisterCatalogSnapshotWithRevision,
  getRegisterCatalogRevision,
  listRegisterCatalogAvailability,
  listRegisterCatalogAvailabilitySnapshot,
  mapPendingCheckoutReviewStatusToWorkItemPatch,
  quickAddSku,
  resolvePendingCheckoutItemReview,
  search,
} from "./catalog";
import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("POS public catalog queries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getServicePrincipalActorWithCtx.mockResolvedValue(null);
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireAuthenticatedAthenaUserIndexedWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
    mocks.requireSharedDemoStoreCapabilityIfApplicable.mockResolvedValue(null);
    mocks.listRegisterCatalogAvailabilitySnapshot.mockResolvedValue([
      {
        productSkuId: "sku-1",
        skuId: "sku-1",
        inStock: true,
        quantityAvailable: 3,
      },
    ]);
    mocks.readRegisterCatalogRevision.mockResolvedValue(0);
    mocks.listRegisterCatalogWithRevision.mockResolvedValue({
      revision: 0,
      rows: [],
    });
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
    mocks.recordInventoryMovementWithCtx.mockResolvedValue({
      _id: "movement-1",
    });
    mocks.applyInventoryEffectWithCtx.mockResolvedValue({
      movement: { _id: "movement-1" },
    });
    mocks.refreshCatalogSummaryWithCtx.mockResolvedValue("summary-1");
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

  it("reads same-store catalog data with current POS application authority", async () => {
    mocks.getServicePrincipalActorWithCtx.mockResolvedValue({
      kind: "service_principal",
      storeId: "store-1",
    });
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValue({
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    mocks.searchProducts.mockResolvedValue([{ id: "sku-1" }]);
    const ctx = buildCtx();

    await expect(
      getHandler(search)(ctx as never, {
        storeId: "store-1",
        searchQuery: "soap",
      }),
    ).resolves.toEqual([{ id: "sku-1" }]);
    expect(mocks.requirePosApplicationAuthorityWithCtx).toHaveBeenCalledWith(
      ctx,
      { storeId: "store-1" },
    );
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
  });

  it.each(["cross-store scope", "revoked current authority"])(
    "denies catalog reads for %s",
    async () => {
      mocks.getServicePrincipalActorWithCtx.mockResolvedValue({
        kind: "service_principal",
        storeId: "store-1",
      });
      mocks.requirePosApplicationAuthorityWithCtx.mockRejectedValue(
        new Error("The POS application session is no longer authorized."),
      );
      const ctx = buildCtx();

      await expect(
        getHandler(search)(ctx as never, {
          storeId: "store-1",
          searchQuery: "soap",
        }),
      ).rejects.toThrow(
        "The POS application session is no longer authorized.",
      );
      expect(mocks.searchProducts).not.toHaveBeenCalled();
    },
  );

  it("validates representative public catalog returns against exported validators", () => {
    const catalogResult = {
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
    };
    const catalogAvailability = {
      availabilityPolicy: "trusted_inventory" as const,
      inStock: true,
      productSkuId: "sku-1",
      quantityAvailable: 3,
      skuId: "sku-1",
    };
    const pendingCheckoutResult = {
      id: "pending-1",
      lookupCode: "123456789012",
      name: "Missing item",
      pendingCheckoutItemId: "pending-1",
      price: 12000,
      productId: "product-1",
      productSkuId: "sku-1",
      quantitySold: 1,
      reviewPriority: "normal" as const,
      sku: "PENDING-1",
      status: "pending_review" as const,
    };
    const pendingReviewItem = {
      _id: "pending-1",
      createdAt: 1,
      createdFrom: "online" as const,
      evidence: {},
      lookupCode: "123456789012",
      name: "Missing item",
      provisionalPrice: 12000,
      reviewPriority: "normal" as const,
      status: "pending_review" as const,
      updatedAt: 2,
    };

    assertConformsToExportedReturns(barcodeLookup, catalogResult);
    assertConformsToExportedReturns(quickAddSku, catalogResult);
    assertConformsToExportedReturns(listRegisterCatalogAvailability, [
      catalogAvailability,
    ]);
    assertConformsToExportedReturns(listRegisterCatalogAvailabilitySnapshot, [
      catalogAvailability,
    ]);
    assertConformsToExportedReturns(
      createOrReusePendingCheckoutItemForSale,
      pendingCheckoutResult,
    );
    assertConformsToExportedReturns(listPendingCheckoutItemsForReview, [
      pendingReviewItem,
    ]);
    assertConformsToExportedReturns(listLinkedPendingCheckoutAliasesBySku, [
      {
        aliases: [
          {
            lookupCode: "123456789012",
            name: "Missing item",
            pendingCheckoutItemId: "pending-1",
            provisionalProductId: "product-1",
            provisionalProductSkuId: "sku-1",
            provisionalSku: "PENDING-1",
            quantitySold: 1,
          },
        ],
        count: 1,
        productSkuId: "sku-1",
      },
    ]);
    assertConformsToExportedReturns(
      listLinkedPendingCheckoutProvisionalBindingsBySku,
      [
        {
          linkedTarget: {
            isArchived: false,
            price: 12000,
            productId: "product-2",
            productName: "Trusted item",
            quantityAvailable: 3,
            sku: "TRUSTED-1",
            skuId: "sku-2",
          },
          pendingCheckoutItemId: "pending-1",
          productSkuId: "sku-1",
        },
      ],
    );
    assertConformsToExportedReturns(resolvePendingCheckoutItemReview, {
      data: pendingReviewItem,
      kind: "ok",
    });
    assertConformsToExportedReturns(listPendingCheckoutProductPageBinding, {
      activeRowCount: 1,
      row: {
        _id: "pending-1",
        importKey: "pending-checkout",
        importedQuantity: 1,
        provisionalSoldQuantity: 1,
        rowNumber: 1,
        saleCount: 1,
      },
      saleEvidenceFingerprint: "sale-fingerprint",
      state: "unique",
      trustedSkuFingerprint: "sku-fingerprint",
    });
    assertConformsToExportedReturns(
      finalizePendingCheckoutTrustedInventoryFromProductPage,
      {
        data: {
          finalTrustedQuantity: 2,
          product: {
            availability: "live",
            inventoryCount: 2,
            isVisible: true,
            quantityAvailable: 2,
          },
          productId: "product-1",
          productSkuId: "sku-1",
          provisionalSkuId: "pending-1",
          provisionalSoldQuantity: 1,
          quantityAvailable: 2,
        },
        kind: "ok",
      },
    );
  });

  it("maps pending checkout review decisions to source-owned work item states", () => {
    expect(mapPendingCheckoutReviewStatusToWorkItemPatch("approved")).toEqual({
      approvalState: "approved",
      status: "completed",
    });
    expect(
      mapPendingCheckoutReviewStatusToWorkItemPatch("linked_to_catalog"),
    ).toEqual({
      approvalState: "approved",
      status: "completed",
    });
    expect(mapPendingCheckoutReviewStatusToWorkItemPatch("rejected")).toEqual({
      approvalState: "rejected",
      status: "completed",
    });
    expect(mapPendingCheckoutReviewStatusToWorkItemPatch("flagged")).toEqual({
      approvalState: "needs_review",
      status: "open",
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
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(
      ctx,
      { sharedDemoCapability: "pos.sale.complete" },
    );
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage:
          "You cannot view register catalog availability for this store.",
        organizationId: "org-1",
        userId: "athena-user-1",
      },
    );
    expect(mocks.listRegisterCatalogAvailabilitySnapshot).toHaveBeenCalledWith(
      ctx,
      { storeId: "store-1" },
    );
  });

  it("requires same-organization POS access before returning the full register catalog snapshot", async () => {
    const readRegisterCatalog =
      await import("../application/queries/listRegisterCatalog");
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
    assertConformsToExportedReturns(listRegisterCatalogSnapshot, rows);
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(
      ctx,
      { sharedDemoCapability: "pos.sale.complete" },
    );
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage:
          "You cannot view register catalog availability for this store.",
        organizationId: "org-1",
        userId: "athena-user-1",
      },
    );
    expect(readRegisterCatalog.listRegisterCatalog).toHaveBeenCalledWith(ctx, {
      storeId: "store-1",
    });
  });

  it("returns only the current register catalog revision after store authorization", async () => {
    mocks.readRegisterCatalogRevision.mockResolvedValue(7);
    const ctx = buildCtx();

    const revision = await getHandler(getRegisterCatalogRevision)(
      ctx as never,
      {
        storeId: "store-1",
      },
    );

    expect(revision).toEqual({ revision: 7, status: "ready" });
    assertConformsToExportedReturns(getRegisterCatalogRevision, revision);

    expect(mocks.readRegisterCatalogRevision).toHaveBeenCalledWith(
      ctx,
      "store-1",
    );
    expect(
      mocks.requireAuthenticatedAthenaUserIndexedWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      sharedDemoCapability: "pos.sale.complete",
    });
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalled();
  });

  it("returns an authorization pause sentinel without reading revision data", async () => {
    mocks.requireAuthenticatedAthenaUserIndexedWithCtx.mockRejectedValueOnce(
      new Error("Not authenticated"),
    );
    const ctx = buildCtx();

    const result = await getHandler(getRegisterCatalogRevision)(ctx as never, {
      storeId: "store-1",
    });

    expect(result).toEqual({ status: "authorization-paused" });
    assertConformsToExportedReturns(getRegisterCatalogRevision, result);
    expect(mocks.readRegisterCatalogRevision).not.toHaveBeenCalled();
  });

  it("returns revision and rows from one authorized query snapshot", async () => {
    const envelope = { revision: 8, rows: [] };
    mocks.listRegisterCatalogWithRevision.mockResolvedValue(envelope);
    const ctx = buildCtx();

    const result = await getHandler(listRegisterCatalogSnapshotWithRevision)(
      ctx as never,
      { storeId: "store-1" },
    );

    expect(result).toEqual(envelope);
    assertConformsToExportedReturns(
      listRegisterCatalogSnapshotWithRevision,
      result,
    );

    expect(mocks.listRegisterCatalogWithRevision).toHaveBeenCalledWith(ctx, {
      storeId: "store-1",
    });
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalled();
  });

  it.each([
    [search, { searchQuery: "milk", storeId: "other-store" }, mocks.searchProducts],
    [barcodeLookup, { barcode: "123456789012", storeId: "other-store" }, mocks.lookupByBarcode],
  ] as const)("rejects a cross-store direct catalog read before its reader runs", async (fn, args, reader) => {
    const denial = new Error("This action is unavailable in the demo.");
    mocks.requireSharedDemoStoreCapabilityIfApplicable.mockRejectedValueOnce(denial);
    const ctx = buildCtx();
    await expect(getHandler(fn)(ctx as never, args)).rejects.toThrow(denial.message);
    expect(mocks.requireSharedDemoStoreCapabilityIfApplicable).toHaveBeenCalledWith(
      ctx,
      "pos.sale.complete",
      "other-store",
    );
    expect(reader).not.toHaveBeenCalled();
  });

  it("lists linked pending checkout aliases for trusted SKU rows", async () => {
    const ctx = buildCtx({
      products: [
        { _id: "product-pending-1", availability: "draft", storeId: "store-1" },
        { _id: "product-pending-2", availability: "draft", storeId: "store-1" },
        {
          _id: "product-pending-other",
          availability: "draft",
          storeId: "store-1",
        },
        {
          _id: "product-pending-archived",
          availability: "archived",
          storeId: "store-1",
        },
      ],
      productSkus: [
        {
          _id: "sku-pending-1",
          productId: "product-pending-1",
          sku: "PENDING-1",
          storeId: "store-1",
        },
        {
          _id: "sku-pending-2",
          productId: "product-pending-2",
          sku: "PENDING-2",
          storeId: "store-1",
        },
        {
          _id: "sku-pending-other",
          productId: "product-pending-other",
          sku: "PENDING-OTHER",
          storeId: "store-1",
        },
        {
          _id: "sku-pending-archived",
          productId: "product-pending-archived",
          sku: "PENDING-ARCHIVED",
          storeId: "store-1",
        },
      ],
      pendingCheckoutItems: [
        {
          _id: "pending-linked-1",
          approvedProductSkuId: "sku-live-1",
          evidence: {
            totalQuantitySold: 3,
          },
          lookupCode: "ALIAS-1",
          name: "Alias one",
          provisionalProductId: "product-pending-1",
          provisionalProductSkuId: "sku-pending-1",
          status: "linked_to_catalog",
          storeId: "store-1",
        },
        {
          _id: "pending-linked-2",
          approvedProductSkuId: "sku-live-1",
          evidence: {
            totalQuantitySold: 1,
          },
          name: "Alias two",
          provisionalProductId: "product-pending-2",
          provisionalProductSkuId: "sku-pending-2",
          status: "linked_to_catalog",
          storeId: "store-1",
        },
        {
          _id: "pending-other",
          approvedProductSkuId: "sku-live-2",
          evidence: {
            totalQuantitySold: 5,
          },
          lookupCode: "OTHER",
          name: "Other alias",
          provisionalProductId: "product-pending-other",
          provisionalProductSkuId: "sku-pending-other",
          status: "linked_to_catalog",
          storeId: "store-1",
        },
        {
          _id: "pending-archived",
          approvedProductSkuId: "sku-live-1",
          evidence: {
            totalQuantitySold: 2,
          },
          lookupCode: "ARCHIVED",
          name: "Archived alias",
          provisionalProductId: "product-pending-archived",
          provisionalProductSkuId: "sku-pending-archived",
          status: "linked_to_catalog",
          storeId: "store-1",
        },
        {
          _id: "pending-review",
          approvedProductSkuId: "sku-live-1",
          evidence: {
            totalQuantitySold: 7,
          },
          lookupCode: "REVIEW",
          name: "Unlinked review",
          status: "pending_review",
          storeId: "store-1",
        },
      ],
    });

    const summaries = await getHandler(listLinkedPendingCheckoutAliasesBySku)(
      ctx as never,
      {
        productSkuIds: [
          "sku-live-1" as Id<"productSku">,
          "sku-live-2" as Id<"productSku">,
          "sku-empty" as Id<"productSku">,
        ],
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(summaries).toEqual([
      {
        aliases: [
          {
            lookupCode: "ALIAS-1",
            name: "Alias one",
            pendingCheckoutItemId: "pending-linked-1",
            provisionalProductId: "product-pending-1",
            provisionalProductSkuId: "sku-pending-1",
            provisionalSku: "PENDING-1",
            quantitySold: 3,
          },
          {
            name: "Alias two",
            pendingCheckoutItemId: "pending-linked-2",
            provisionalProductId: "product-pending-2",
            provisionalProductSkuId: "sku-pending-2",
            provisionalSku: "PENDING-2",
            quantitySold: 1,
          },
        ],
        count: 2,
        productSkuId: "sku-live-1",
      },
      {
        aliases: [
          {
            lookupCode: "OTHER",
            name: "Other alias",
            pendingCheckoutItemId: "pending-other",
            provisionalProductId: "product-pending-other",
            provisionalProductSkuId: "sku-pending-other",
            provisionalSku: "PENDING-OTHER",
            quantitySold: 5,
          },
        ],
        count: 1,
        productSkuId: "sku-live-2",
      },
    ]);
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin"],
        failureMessage:
          "You cannot review pending checkout items for this store.",
        organizationId: "org-1",
        userId: "athena-user-1",
      },
    );
  });

  it("does not return the register catalog snapshot when the caller is unauthenticated", async () => {
    const readRegisterCatalog =
      await import("../application/queries/listRegisterCatalog");
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
    const readRegisterCatalogAvailability =
      await import("../application/queries/listRegisterCatalog");
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

    const rows = await getHandler(listRegisterCatalogAvailability)(
      ctx as never,
      {
        storeId: "store-1",
        productSkuIds: ["sku-1"],
      },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        productSkuId: "sku-1",
        quantityAvailable: 3,
      }),
    ]);
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage:
          "You cannot view register catalog availability for this store.",
        organizationId: "org-1",
        userId: "athena-user-1",
      },
    );
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

    expect(
      mocks.listRegisterCatalogAvailabilitySnapshot,
    ).not.toHaveBeenCalled();
  });

  it("does not return bounded availability when the caller is unauthenticated", async () => {
    const readRegisterCatalogAvailability =
      await import("../application/queries/listRegisterCatalog");
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

    expect(
      mocks.requireSharedDemoStoreCapabilityIfApplicable,
    ).toHaveBeenCalledWith(ctx, "catalog.quick_add", "store-1");
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(
      ctx,
      { sharedDemoCapability: "catalog.quick_add" },
    );
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You cannot quick add products for this store.",
        organizationId: "org-1",
        userId: "athena-user-1",
      },
    );
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

  it("quick-adds with same-store POS authority plus current staff, register, and terminal context", async () => {
    mocks.getServicePrincipalActorWithCtx.mockResolvedValue({
      kind: "service_principal",
      storeId: "store-1",
    });
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValue({
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    const ctx = buildCtx({
      staffProfile: {
        _id: "staff-1",
        linkedUserId: "linked-user-1",
        status: "active",
        storeId: "store-1",
      },
    });

    await getHandler(quickAddSku)(ctx as never, {
      createdByStaffProfileId: "staff-1",
      createdByUserId: "forged-user",
      name: "Quick item",
      price: 12000,
      quantityAvailable: 1,
      registerSessionId: "register-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(mocks.quickAddCatalogItem).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        createdByStaffProfileId: "staff-1",
        createdByUserId: "linked-user-1",
        registerSessionId: "register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
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
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(
      ctx,
    );
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You cannot add pending checkout items for this store.",
        organizationId: "org-1",
        userId: "athena-user-1",
      },
    );
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

  it("creates a pending checkout item with current POS authority while retaining register and staff checks", async () => {
    mocks.getServicePrincipalActorWithCtx.mockResolvedValue({
      kind: "service_principal",
      storeId: "store-1",
    });
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValue({
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    const ctx = buildCtx({
      staffProfile: {
        _id: "staff-1",
        linkedUserId: "linked-user-1",
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
        createdByUserId: "linked-user-1",
        registerSessionId: "register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
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
    ).rejects.toThrow(
      "You cannot review pending checkout items for this store.",
    );

    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("lists pending checkout review items using the public review shape", async () => {
    const ctx = buildCtx({
      pendingCheckoutItems: [
        {
          _creationTime: 1,
          _id: "pending-1",
          createdAt: 10,
          createdByStaffProfileId: "staff-1",
          createdByUserId: "athena-user-1",
          createdFrom: "offline_sync",
          currency: "ghs",
          evidence: {
            firstSeenAt: 10,
            lastSeenAt: 20,
            observedLookupCodes: [],
            observedPrices: [350000],
            offlineSaleCount: 16,
            totalQuantitySold: 20,
            transactionCount: 16,
          },
          name: "Missing item",
          normalizedName: "missing item",
          operationalWorkItemId: "work-item-1",
          organizationId: "org-1",
          provisionalPrice: 350000,
          provisionalProductId: "product-provisional-1",
          provisionalProductSkuId: "sku-provisional-1",
          reviewPriority: "high",
          status: "pending_review",
          storeId: "store-1",
          updatedAt: 20,
        },
      ],
    });

    const rows = await getHandler(listPendingCheckoutItemsForReview)(
      ctx as never,
      {
        storeId: "store-1",
      },
    );

    expect(rows).toEqual([
      {
        _id: "pending-1",
        createdAt: 10,
        createdFrom: "offline_sync",
        evidence: expect.objectContaining({
          totalQuantitySold: 20,
          transactionCount: 16,
        }),
        name: "Missing item",
        provisionalPrice: 350000,
        reviewPriority: "high",
        status: "pending_review",
        updatedAt: 20,
      },
    ]);
    expect(rows[0]).not.toHaveProperty("_creationTime");
    expect(rows[0]).not.toHaveProperty("organizationId");
    expect(rows[0]).not.toHaveProperty("provisionalProductId");
    assertConformsToExportedReturns(listPendingCheckoutItemsForReview, rows);
  });

  it("returns the pending checkout product-page binding for the provisional SKU", async () => {
    const ctx = buildCtx({
      pendingCheckoutItems: [
        {
          _id: "pending-1",
          createdAt: 10,
          createdFrom: "offline_sync",
          currency: "ghs",
          evidence: {
            firstSeenAt: 10,
            lastPosTransactionId: "transaction-1",
            lastRegisterSessionId: "register-1",
            lastSeenAt: 20,
            observedLookupCodes: [],
            observedPrices: [350000],
            totalQuantitySold: 20,
            transactionCount: 16,
          },
          name: "Missing item",
          normalizedName: "missing item",
          organizationId: "org-1",
          provisionalPrice: 350000,
          provisionalProductId: "product-provisional-1",
          provisionalProductSkuId: "sku-provisional-1",
          reviewPriority: "high",
          status: "pending_review",
          storeId: "store-1",
          updatedAt: 20,
        },
      ],
      product: {
        _id: "product-provisional-1",
        availability: "draft",
        inventoryCount: 0,
        isVisible: false,
        quantityAvailable: 0,
        storeId: "store-1",
      },
      productSku: {
        _id: "sku-provisional-1",
        inventoryCount: 0,
        isVisible: false,
        price: 350000,
        productId: "product-provisional-1",
        quantityAvailable: 0,
        storeId: "store-1",
      },
    });

    const binding = await getHandler(listPendingCheckoutProductPageBinding)(
      ctx as never,
      {
        productSkuId: "sku-provisional-1",
        storeId: "store-1",
      },
    );

    expect(binding).toMatchObject({
      activeRowCount: 1,
      row: {
        _id: "pending-1",
        importKey: "pending-checkout",
        importedQuantity: 20,
        lastPosTransactionId: "transaction-1",
        lastRegisterSessionId: "register-1",
        lastSoldAt: 20,
        provisionalSoldQuantity: 20,
        rowNumber: 1,
        saleCount: 16,
        updatedAt: 20,
      },
      state: "unique",
    });
    expect(binding.saleEvidenceFingerprint).toEqual(expect.any(String));
    expect(binding.trustedSkuFingerprint).toEqual(expect.any(String));
    assertConformsToExportedReturns(
      listPendingCheckoutProductPageBinding,
      binding,
    );
  });

  it("returns linked checkout product-page binding target details", async () => {
    const ctx = buildCtx({
      pendingCheckoutItems: [
        {
          _id: "pending-1",
          approvedProductId: "product-linked-1",
          approvedProductSkuId: "sku-linked-1",
          createdAt: 10,
          createdFrom: "offline_sync",
          currency: "ghs",
          evidence: {
            firstSeenAt: 10,
            lastPosTransactionId: "transaction-1",
            lastRegisterSessionId: "register-1",
            lastSeenAt: 20,
            observedLookupCodes: [],
            observedPrices: [350000],
            totalQuantitySold: 20,
            transactionCount: 16,
          },
          name: "Missing item",
          normalizedName: "missing item",
          organizationId: "org-1",
          provisionalPrice: 350000,
          provisionalProductId: "product-provisional-1",
          provisionalProductSkuId: "sku-provisional-1",
          reviewPriority: "high",
          status: "linked_to_catalog",
          storeId: "store-1",
          updatedAt: 20,
        },
      ],
      products: [
        {
          _id: "product-provisional-1",
          availability: "live",
          inventoryCount: 0,
          isVisible: false,
          name: "Missing item",
          quantityAvailable: 0,
          storeId: "store-1",
        },
        {
          _id: "product-linked-1",
          availability: "live",
          inventoryCount: 5,
          isVisible: true,
          name: "Trusted item",
          quantityAvailable: 5,
          storeId: "store-1",
        },
      ],
      productSkus: [
        {
          _id: "sku-provisional-1",
          inventoryCount: 0,
          isVisible: false,
          price: 350000,
          productId: "product-provisional-1",
          quantityAvailable: 0,
          sku: "PENDING-1",
          storeId: "store-1",
        },
        {
          _id: "sku-linked-1",
          inventoryCount: 5,
          isVisible: true,
          price: 60000,
          productId: "product-linked-1",
          quantityAvailable: 4,
          sku: "TRUSTED-1",
          storeId: "store-1",
        },
      ],
    });

    const binding = await getHandler(listPendingCheckoutProductPageBinding)(
      ctx as never,
      {
        productSkuId: "sku-provisional-1",
        storeId: "store-1",
      },
    );

    expect(binding).toMatchObject({
      activeRowCount: 1,
      row: {
        _id: "pending-1",
        linkedTarget: {
          isArchived: false,
          price: 60000,
          productId: "product-linked-1",
          productName: "Trusted item",
          quantityAvailable: 4,
          sku: "TRUSTED-1",
          skuId: "sku-linked-1",
        },
        status: "linked_to_catalog",
      },
      state: "unique",
    });
    assertConformsToExportedReturns(
      listPendingCheckoutProductPageBinding,
      binding,
    );
  });

  it("lists linked pending checkout provisional bindings for locked rows", async () => {
    const ctx = buildCtx({
      pendingCheckoutItems: [
        {
          _id: "pending-1",
          approvedProductId: "product-linked-1",
          approvedProductSkuId: "sku-linked-1",
          createdAt: 10,
          createdFrom: "offline_sync",
          currency: "ghs",
          evidence: {
            firstSeenAt: 10,
            lastSeenAt: 20,
            observedLookupCodes: [],
            observedPrices: [350000],
            totalQuantitySold: 20,
            transactionCount: 16,
          },
          name: "Missing item",
          normalizedName: "missing item",
          organizationId: "org-1",
          provisionalPrice: 350000,
          provisionalProductId: "product-provisional-1",
          provisionalProductSkuId: "sku-provisional-1",
          reviewPriority: "high",
          status: "linked_to_catalog",
          storeId: "store-1",
          updatedAt: 20,
        },
      ],
      products: [
        {
          _id: "product-provisional-1",
          availability: "live",
          inventoryCount: 0,
          isVisible: false,
          name: "Missing item",
          quantityAvailable: 0,
          storeId: "store-1",
        },
        {
          _id: "product-linked-1",
          availability: "live",
          inventoryCount: 5,
          isVisible: true,
          name: "Trusted item",
          quantityAvailable: 5,
          storeId: "store-1",
        },
      ],
      productSkus: [
        {
          _id: "sku-provisional-1",
          inventoryCount: 0,
          isVisible: false,
          price: 350000,
          productId: "product-provisional-1",
          quantityAvailable: 0,
          sku: "PENDING-1",
          storeId: "store-1",
        },
        {
          _id: "sku-linked-1",
          inventoryCount: 5,
          isVisible: true,
          price: 60000,
          productId: "product-linked-1",
          quantityAvailable: 4,
          sku: "TRUSTED-1",
          storeId: "store-1",
        },
      ],
    });

    const bindings = await getHandler(
      listLinkedPendingCheckoutProvisionalBindingsBySku,
    )(ctx as never, {
      productSkuIds: ["sku-provisional-1", "sku-other"],
      storeId: "store-1",
    });

    expect(bindings).toEqual([
      {
        linkedTarget: {
          isArchived: false,
          price: 60000,
          productId: "product-linked-1",
          productName: "Trusted item",
          quantityAvailable: 4,
          sku: "TRUSTED-1",
          skuId: "sku-linked-1",
        },
        pendingCheckoutItemId: "pending-1",
        productSkuId: "sku-provisional-1",
      },
    ]);
  });

  it("marks linked pending checkout provisional bindings when the trusted target is archived", async () => {
    const ctx = buildCtx({
      pendingCheckoutItems: [
        {
          _id: "pending-1",
          approvedProductId: "product-linked-1",
          approvedProductSkuId: "sku-linked-1",
          createdAt: 10,
          createdFrom: "offline_sync",
          currency: "ghs",
          evidence: {
            firstSeenAt: 10,
            lastSeenAt: 20,
            observedLookupCodes: [],
            observedPrices: [350000],
            totalQuantitySold: 20,
            transactionCount: 16,
          },
          name: "Missing item",
          normalizedName: "missing item",
          organizationId: "org-1",
          provisionalPrice: 350000,
          provisionalProductId: "product-provisional-1",
          provisionalProductSkuId: "sku-provisional-1",
          reviewPriority: "high",
          status: "linked_to_catalog",
          storeId: "store-1",
          updatedAt: 20,
        },
      ],
      products: [
        {
          _id: "product-provisional-1",
          availability: "live",
          inventoryCount: 0,
          isVisible: true,
          name: "Missing item",
          quantityAvailable: 0,
          storeId: "store-1",
        },
        {
          _id: "product-linked-1",
          availability: "archived",
          inventoryCount: 5,
          isVisible: true,
          name: "Trusted item",
          quantityAvailable: 5,
          storeId: "store-1",
        },
      ],
      productSkus: [
        {
          _id: "sku-provisional-1",
          inventoryCount: 0,
          isVisible: true,
          price: 350000,
          productId: "product-provisional-1",
          quantityAvailable: 0,
          sku: "PENDING-1",
          storeId: "store-1",
        },
        {
          _id: "sku-linked-1",
          inventoryCount: 5,
          isVisible: true,
          price: 60000,
          productId: "product-linked-1",
          quantityAvailable: 4,
          sku: "TRUSTED-1",
          storeId: "store-1",
        },
      ],
    });

    const bindings = await getHandler(
      listLinkedPendingCheckoutProvisionalBindingsBySku,
    )(ctx as never, {
      productSkuIds: ["sku-provisional-1"],
      storeId: "store-1",
    });

    expect(bindings).toEqual([
      {
        linkedTarget: {
          isArchived: true,
          price: 60000,
          productId: "product-linked-1",
          productName: "Trusted item",
          quantityAvailable: 4,
          sku: "TRUSTED-1",
          skuId: "sku-linked-1",
        },
        pendingCheckoutItemId: "pending-1",
        productSkuId: "sku-provisional-1",
      },
    ]);
    assertConformsToExportedReturns(
      listLinkedPendingCheckoutProvisionalBindingsBySku,
      bindings,
    );
  });

  it("finalizes a POS pending checkout draft SKU as trusted inventory", async () => {
    const pendingCheckoutItem = {
      _id: "pending-1",
      createdAt: 10,
      createdFrom: "offline_sync",
      currency: "ghs",
      evidence: {
        firstSeenAt: 10,
        lastPosTransactionId: "transaction-1",
        lastRegisterSessionId: "register-1",
        lastSeenAt: 20,
        observedLookupCodes: [],
        observedPrices: [350000],
        totalQuantitySold: 20,
        transactionCount: 16,
      },
      name: "Missing item",
      normalizedName: "missing item",
      operationalWorkItemId: "work-item-1",
      organizationId: "org-1",
      provisionalPrice: 350000,
      provisionalProductId: "product-provisional-1",
      provisionalProductSkuId: "sku-provisional-1",
      reviewPriority: "high",
      status: "pending_review",
      storeId: "store-1",
      updatedAt: 20,
    };
    const product = {
      _id: "product-provisional-1",
      availability: "draft",
      inventoryCount: 0,
      isVisible: false,
      quantityAvailable: 0,
      storeId: "store-1",
    };
    const productSku = {
      _id: "sku-provisional-1",
      inventoryCount: 0,
      isVisible: true,
      price: 350000,
      productId: "product-provisional-1",
      quantityAvailable: 0,
      storeId: "store-1",
    };
    const ctx = buildCtx({
      pendingCheckoutItem,
      pendingCheckoutItems: [pendingCheckoutItem],
      product,
      productSku,
    });
    const binding = await getHandler(listPendingCheckoutProductPageBinding)(
      ctx as never,
      {
        productSkuId: "sku-provisional-1",
        storeId: "store-1",
      },
    );

    const result = await getHandler(
      finalizePendingCheckoutTrustedInventoryFromProductPage,
    )(ctx as never, {
      conversionRequestId: "conversion-1",
      productId: "product-provisional-1",
      productSkuId: "sku-provisional-1",
      provisionalSkuId: "pending-1",
      reviewedInventoryCount: 20,
      reviewedIsVisible: true,
      reviewedNetPrice: 350000,
      reviewedPrice: 350000,
      reviewedQuantityAvailable: 20,
      reviewedUnitCost: 0,
      saleEvidenceFingerprint: binding.saleEvidenceFingerprint,
      sourceSurface: "product_edit",
      storeId: "store-1",
      trustedSkuFingerprint: binding.trustedSkuFingerprint,
    });

    expect(result).toMatchObject({
      data: {
        finalTrustedQuantity: 20,
        product: {
          availability: "live",
          inventoryCount: 20,
          posVisible: true,
          quantityAvailable: 20,
        },
        productId: "product-provisional-1",
        productSkuId: "sku-provisional-1",
        provisionalSkuId: "pending-1",
        provisionalSoldQuantity: 20,
        quantityAvailable: 20,
      },
      kind: "ok",
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "productSku",
      "sku-provisional-1",
      {
        isVisible: true,
        posVisible: true,
        netPrice: 350000,
        price: 350000,
      },
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "product",
      "product-provisional-1",
      {
        availability: "live",
        inventoryCount: 20,
        posVisible: true,
        quantityAvailable: 20,
      },
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posPendingCheckoutItem",
      "pending-1",
      expect.objectContaining({
        approvedProductId: "product-provisional-1",
        approvedProductSkuId: "sku-provisional-1",
        status: "approved",
      }),
    );
    expect(mocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        businessEventKey: "pending_checkout:pending-1:trusted:conversion-1",
        movementType: "pending_checkout_trusted_finalization",
        physicalQuantityDelta: 20,
        sellableQuantityDelta: 20,
        sourceId: "pending-1",
        sourceType: "pos_pending_checkout_item",
        valuation: expect.objectContaining({
          costBasis: expect.objectContaining({ kind: "known", unitCost: 0 }),
          kind: "inbound",
          quantity: 20,
        }),
      }),
    );
    expect(mocks.updateOperationalWorkItemStatusWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        approvalState: "approved",
        status: "completed",
        workItemId: "work-item-1",
      },
    );
    assertConformsToExportedReturns(
      finalizePendingCheckoutTrustedInventoryFromProductPage,
      result,
    );
  });

  it("rejects POS-hidden pending checkout trusted inventory finalization", async () => {
    const product = {
      _id: "product-provisional-1",
      availability: "draft",
      categoryId: "category-legacy",
      inventoryCount: 0,
      isVisible: false,
      posVisible: true,
      name: "Imported SKU",
      quantityAvailable: 0,
      storeId: "store-1",
    };
    const productSku = {
      _id: "sku-provisional-1",
      inventoryCount: 0,
      isVisible: true,
      posVisible: true,
      price: 350000,
      productId: "product-provisional-1",
      quantityAvailable: 0,
      storeId: "store-1",
    };
    const pendingCheckoutItem = {
      _id: "pending-1",
      evidence: {
        observedLookupCodes: ["123"],
        observedPrices: [350000],
        totalQuantitySold: 20,
        transactionCount: 1,
      },
      lookupCode: "123",
      name: "Imported SKU",
      provisionalPrice: 350000,
      provisionalProductId: "product-provisional-1",
      provisionalProductSkuId: "sku-provisional-1",
      reviewPriority: "normal",
      status: "pending_review",
      storeId: "store-1",
      updatedAt: 1,
    };
    const ctx = buildCtx({
      pendingCheckoutItem,
      pendingCheckoutItems: [pendingCheckoutItem],
      product,
      productSku,
    });
    const binding = await getHandler(listPendingCheckoutProductPageBinding)(
      ctx as never,
      {
        productSkuId: "sku-provisional-1",
        storeId: "store-1",
      },
    );

    const result = await getHandler(
      finalizePendingCheckoutTrustedInventoryFromProductPage,
    )(ctx as never, {
      conversionRequestId: "conversion-1",
      productId: "product-provisional-1",
      productSkuId: "sku-provisional-1",
      provisionalSkuId: "pending-1",
      reviewedInventoryCount: 20,
      reviewedIsVisible: true,
      reviewedPosVisible: false,
      reviewedNetPrice: 350000,
      reviewedPrice: 350000,
      reviewedQuantityAvailable: 20,
      reviewedUnitCost: 0,
      saleEvidenceFingerprint: binding.saleEvidenceFingerprint,
      sourceSurface: "product_edit",
      storeId: "store-1",
      trustedSkuFingerprint: binding.trustedSkuFingerprint,
    });

    expect(result).toMatchObject({
      error: {
        code: "precondition_failed",
        message:
          "Make this SKU available in POS before finalizing trusted inventory.",
      },
      kind: "user_error",
    });
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "productSku",
      "sku-provisional-1",
      expect.anything(),
    );
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "product",
      "product-provisional-1",
      expect.anything(),
    );
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
    ).rejects.toThrow(
      "You cannot resolve pending checkout items for this store.",
    );

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

    const result = await getHandler(resolvePendingCheckoutItemReview)(
      ctx as never,
      {
        pendingCheckoutItemId: "pending-1",
        status: "approved",
        storeId: "store-1",
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "validation_failed",
        message: "Choose a valid catalog product and SKU from this store.",
      },
      kind: "user_error",
    });
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

    const result = await getHandler(resolvePendingCheckoutItemReview)(
      ctx as never,
      {
        approvedProductId: "product-provisional-1",
        approvedProductSkuId: "sku-provisional-1",
        pendingCheckoutItemId: "pending-1",
        status: "linked_to_catalog",
        storeId: "store-1",
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "validation_failed",
        message: "Choose a valid catalog product and SKU from this store.",
      },
      kind: "user_error",
    });
  });

  it("allows pending checkout review links to POS quick add trusted SKUs", async () => {
    const ctx = buildCtx({
      category: {
        _id: "category-pos-quick-add",
        slug: "pos-quick-add",
        storeId: "store-1",
      },
      pendingCheckoutItem: {
        _id: "pending-1",
        evidence: {
          observedLookupCodes: [],
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
        _id: "product-quick-add-1",
        availability: "live",
        categoryId: "category-pos-quick-add",
        isVisible: false,
        storeId: "store-1",
      },
      productSku: {
        _id: "sku-quick-add-1",
        isVisible: false,
        price: 12000,
        productId: "product-quick-add-1",
        storeId: "store-1",
      },
    });

    await getHandler(resolvePendingCheckoutItemReview)(ctx as never, {
      approvedProductId: "product-quick-add-1",
      approvedProductSkuId: "sku-quick-add-1",
      pendingCheckoutItemId: "pending-1",
      status: "linked_to_catalog",
      storeId: "store-1",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posPendingCheckoutItem",
      "pending-1",
      expect.objectContaining({
        approvedProductId: "product-quick-add-1",
        approvedProductSkuId: "sku-quick-add-1",
        status: "linked_to_catalog",
      }),
    );
  });

  it("allows pending checkout review links using the trusted SKU net price", async () => {
    const ctx = buildCtx({
      pendingCheckoutItem: {
        _id: "pending-1",
        evidence: {
          observedLookupCodes: [],
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
        _id: "product-live-1",
        availability: "live",
        isVisible: true,
        storeId: "store-1",
      },
      productSku: {
        _id: "sku-live-1",
        isVisible: true,
        netPrice: 12000,
        price: 12200,
        productId: "product-live-1",
        storeId: "store-1",
      },
      productSkus: [
        {
          _id: "sku-provisional-1",
          isVisible: false,
          price: 12000,
          productId: "product-provisional-1",
          storeId: "store-1",
        },
      ],
    });

    await getHandler(resolvePendingCheckoutItemReview)(ctx as never, {
      approvedProductId: "product-live-1",
      approvedProductSkuId: "sku-live-1",
      pendingCheckoutItemId: "pending-1",
      status: "linked_to_catalog",
      storeId: "store-1",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posPendingCheckoutItem",
      "pending-1",
      expect.objectContaining({
        approvedProductId: "product-live-1",
        approvedProductSkuId: "sku-live-1",
        status: "linked_to_catalog",
      }),
    );
  });

  it("rejects pending checkout review links when the trusted SKU price differs", async () => {
    const ctx = buildCtx({
      pendingCheckoutItem: {
        _id: "pending-1",
        evidence: {
          observedLookupCodes: [],
          observedPrices: [42000],
          totalQuantitySold: 1,
          transactionCount: 1,
        },
        name: "Missing item",
        provisionalPrice: 42000,
        provisionalProductId: "product-provisional-1",
        provisionalProductSkuId: "sku-provisional-1",
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
        isVisible: true,
        price: 40000,
        productId: "product-live-1",
        storeId: "store-1",
      },
    });

    const result = await getHandler(resolvePendingCheckoutItemReview)(
      ctx as never,
      {
        approvedProductId: "product-live-1",
        approvedProductSkuId: "sku-live-1",
        pendingCheckoutItemId: "pending-1",
        status: "linked_to_catalog",
        storeId: "store-1",
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "validation_failed",
        message:
          "Link to a SKU with the same price as the pending checkout item.",
      },
      kind: "user_error",
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
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
        price: 12000,
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
    expect(mocks.upsertProductSkuSearchProjection).toHaveBeenCalledWith(
      ctx,
      "sku-live-1",
      { advanceRevision: false },
    );
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

  it("creates a lookup alias instead of overwriting an existing trusted SKU barcode", async () => {
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
        barcode: "TRUSTED-BARCODE",
        isVisible: true,
        price: 12000,
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

    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "productSku",
      "sku-live-1",
      expect.anything(),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "posPendingCheckoutLookupAlias",
      expect.objectContaining({
        normalizedLookupCode: "123456789012",
        pendingCheckoutItemId: "pending-1",
        productId: "product-live-1",
        productSkuId: "sku-live-1",
        status: "active",
      }),
    );
    expect(mocks.recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          attachedLookupCode: undefined,
          lookupAliasId: "inserted-posPendingCheckoutLookupAlias",
        }),
      }),
    );
  });

  it("reuses an existing lookup alias for the same pending item and SKU", async () => {
    const ctx = buildCtx({
      lookupAliases: [
        {
          _id: "alias-1",
          normalizedLookupCode: "123456789012",
          pendingCheckoutItemId: "pending-1",
          productId: "product-live-1",
          productSkuId: "sku-live-1",
          status: "active",
          storeId: "store-1",
        },
      ],
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
        barcode: "TRUSTED-BARCODE",
        isVisible: true,
        price: 12000,
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

    expect(ctx.db.insert).not.toHaveBeenCalledWith(
      "posPendingCheckoutLookupAlias",
      expect.anything(),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posPendingCheckoutLookupAlias",
      "alias-1",
      expect.objectContaining({
        productId: "product-live-1",
        productSkuId: "sku-live-1",
      }),
    );
  });

  it("rejects lookup aliases already owned by another pending item", async () => {
    const ctx = buildCtx({
      lookupAliases: [
        {
          _id: "alias-1",
          normalizedLookupCode: "123456789012",
          pendingCheckoutItemId: "pending-other",
          productId: "product-other",
          productSkuId: "sku-other",
          status: "active",
          storeId: "store-1",
        },
      ],
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
        barcode: "TRUSTED-BARCODE",
        isVisible: true,
        price: 12000,
        productId: "product-live-1",
        storeId: "store-1",
      },
    });

    const result = await getHandler(resolvePendingCheckoutItemReview)(
      ctx as never,
      {
        approvedProductId: "product-live-1",
        approvedProductSkuId: "sku-live-1",
        pendingCheckoutItemId: "pending-1",
        status: "linked_to_catalog",
        storeId: "store-1",
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "conflict",
        message: "This lookup code is already linked to another SKU.",
      },
      kind: "user_error",
    });
  });

  it("retires active lookup aliases when a linked item changes before attribution", async () => {
    const ctx = buildCtx({
      lookupAliases: [
        {
          _id: "alias-1",
          normalizedLookupCode: "123456789012",
          pendingCheckoutItemId: "pending-1",
          productId: "product-live-1",
          productSkuId: "sku-live-1",
          status: "active",
          storeId: "store-1",
        },
      ],
      pendingCheckoutItem: {
        _id: "pending-1",
        approvedProductId: "product-live-1",
        approvedProductSkuId: "sku-live-1",
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
        status: "linked_to_catalog",
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
        barcode: "123456789012",
        isVisible: true,
        productId: "product-live-1",
        storeId: "store-1",
      },
    });

    await getHandler(resolvePendingCheckoutItemReview)(ctx as never, {
      pendingCheckoutItemId: "pending-1",
      status: "flagged",
      storeId: "store-1",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posPendingCheckoutLookupAlias",
      "alias-1",
      expect.objectContaining({
        status: "retired",
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "productSku",
      "sku-live-1",
      expect.objectContaining({
        barcode: undefined,
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posPendingCheckoutItem",
      "pending-1",
      expect.objectContaining({
        status: "flagged",
      }),
    );
  });

  it("rejects relinking a linked pending item after transaction attribution", async () => {
    const ctx = buildCtx({
      pendingCheckoutItem: {
        _id: "pending-1",
        approvedProductId: "product-live-1",
        approvedProductSkuId: "sku-live-1",
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
        status: "linked_to_catalog",
        storeId: "store-1",
        updatedAt: 1,
      },
      posTransactionItems: [
        {
          _id: "transaction-item-1",
          pendingCheckoutItemId: "pending-1",
        },
      ],
      product: {
        _id: "product-live-2",
        availability: "live",
        isVisible: true,
        storeId: "store-1",
      },
      productSku: {
        _id: "sku-live-2",
        barcode: "",
        isVisible: true,
        price: 12000,
        productId: "product-live-2",
        storeId: "store-1",
      },
    });

    const result = await getHandler(resolvePendingCheckoutItemReview)(
      ctx as never,
      {
        approvedProductId: "product-live-2",
        approvedProductSkuId: "sku-live-2",
        pendingCheckoutItemId: "pending-1",
        status: "linked_to_catalog",
        storeId: "store-1",
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "conflict",
        message:
          "This pending checkout item is already linked to a trusted SKU. Create a correction to change linked sale history.",
      },
      kind: "user_error",
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
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
        price: 12000,
        productId: "product-live-1",
        storeId: "store-1",
      },
    });

    const result = await getHandler(resolvePendingCheckoutItemReview)(
      ctx as never,
      {
        approvedProductId: "product-live-1",
        approvedProductSkuId: "sku-live-1",
        pendingCheckoutItemId: "pending-1",
        status: "linked_to_catalog",
        storeId: "store-1",
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "conflict",
        message: "This lookup code already belongs to another catalog SKU.",
      },
      kind: "user_error",
    });

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
  pendingCheckoutItems?: Array<Record<string, unknown>>;
  category?: Record<string, unknown>;
  product?: Record<string, unknown>;
  products?: Array<Record<string, unknown>>;
  productSku?: Record<string, unknown>;
  productSkus?: Array<Record<string, unknown>>;
  posTransactionItems?: Array<Record<string, unknown>>;
  lookupAliases?: Array<Record<string, unknown>>;
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
  type QueryIndexBuilder = {
    eq: (field: string, value: unknown) => QueryIndexBuilder;
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
        if (tableName === "registerSession" && registerSession?._id === id) {
          return registerSession;
        }
        if (
          tableName === "posPendingCheckoutItem" &&
          seed?.pendingCheckoutItem?._id === id
        ) {
          return seed.pendingCheckoutItem;
        }
        const products = [
          ...(seed?.product ? [seed.product] : []),
          ...(seed?.products ?? []),
        ];
        const productSkus = [
          ...(seed?.productSku ? [seed.productSku] : []),
          ...(seed?.productSkus ?? []),
        ];
        if (
          tableName === "product" &&
          products.some((product) => product._id === id)
        ) {
          return products.find((product) => product._id === id);
        }
        if (tableName === "product" && seed?.product?._id === id) {
          return seed.product;
        }
        if (
          tableName === "productSku" &&
          productSkus.some((sku) => sku._id === id)
        ) {
          return productSkus.find((sku) => sku._id === id);
        }
        if (tableName === "category" && seed?.category?._id === id) {
          return seed.category;
        }

        return null;
      }),
      insert: vi.fn(async (tableName: string) => `inserted-${tableName}`),
      query: vi.fn((tableName: string) => {
        const filters: Record<string, unknown> = {};

        return {
          withIndex: vi.fn(
            (
              _indexName: string,
              applyIndex: (builder: QueryIndexBuilder) => unknown,
            ) => {
              const builder: QueryIndexBuilder = {
                eq(field: string, value: unknown) {
                  filters[field] = value;
                  return builder;
                },
              };
              applyIndex(builder);

              const rowsForTable = () => {
                if (tableName === "posPendingCheckoutItem") {
                  return seed?.pendingCheckoutItems ?? [];
                }
                if (tableName === "posTransactionItem") {
                  return seed?.posTransactionItems ?? [];
                }
                if (tableName === "posPendingCheckoutLookupAlias") {
                  return seed?.lookupAliases ?? [];
                }
                return [];
              };
              const matchingRows = () =>
                rowsForTable().filter((item) =>
                  Object.entries(filters).every(
                    ([field, value]) => item[field] === value,
                  ),
                );
              const take = vi.fn(async (limit: number) => {
                return matchingRows().slice(0, limit);
              });

              return {
                first: vi.fn(async () => matchingRows()[0] ?? null),
                take,
                order: vi.fn(() => ({
                  take,
                })),
              };
            },
          ),
        };
      }),
      patch: vi.fn(),
    },
  };
}

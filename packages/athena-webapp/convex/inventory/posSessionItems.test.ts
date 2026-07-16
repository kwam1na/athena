import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  runRemoveSessionItemCommand: vi.fn(),
  runUpsertSessionItemCommand: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../pos/application/commands/sessionCommands", () => ({
  runRemoveSessionItemCommand: mocks.runRemoveSessionItemCommand,
  runUpsertSessionItemCommand: mocks.runUpsertSessionItemCommand,
}));

vi.mock(
  "../pos/infrastructure/repositories/sessionCommandRepository",
  () => ({
    collectSessionItemsFromPages: vi.fn(),
  }),
);

import { addOrUpdateItem, getSessionItems, removeItem } from "./posSessionItems";
import { collectSessionItemsFromPages } from "../pos/infrastructure/repositories/sessionCommandRepository";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("posSessionItems public mutations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
    mocks.runUpsertSessionItemCommand.mockResolvedValue({
      data: {
        expiresAt: 1,
        itemId: "item-1",
      },
      status: "ok",
    });
    mocks.runRemoveSessionItemCommand.mockResolvedValue({
      data: {
        expiresAt: 1,
      },
      status: "ok",
    });
  });

  it("requires authenticated store access before adding or updating a session item", async () => {
    const ctx = buildCtx();

    await expect(
      getHandler(addOrUpdateItem)(ctx as never, {
        barcode: "123",
        price: 12000,
        productId: "product-1" as Id<"product">,
        productName: "Closure Wig",
        productSku: "SKU-1",
        productSkuId: "sku-1" as Id<"productSku">,
        quantity: 1,
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
      }),
    ).resolves.toMatchObject({
      data: {
        itemId: "item-1",
      },
      kind: "ok",
    });

    expect(mocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(ctx);
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot change this POS sale.",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(mocks.runUpsertSessionItemCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        sessionId: "session-1",
      }),
    );
  });

  it("does not mutate session items when authorization fails", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("You cannot change this POS sale."),
    );

    await expect(
      getHandler(removeItem)(buildCtx() as never, {
        itemId: "item-1" as Id<"posSessionItem">,
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
      }),
    ).rejects.toThrow("You cannot change this POS sale.");

    expect(mocks.runRemoveSessionItemCommand).not.toHaveBeenCalled();
  });

  it("requires authenticated store access before returning session items", async () => {
    vi.mocked(collectSessionItemsFromPages).mockResolvedValue([
      {
        _id: "item-1",
        _creationTime: 1,
        areProcessingFeesAbsorbed: false,
        createdAt: 1,
        price: 12000,
        productId: "product-1",
        productName: "Closure Wig",
        productSku: "SKU-1",
        productSkuId: "sku-1",
        quantity: 1,
        sessionId: "session-1",
        storeId: "store-1",
        updatedAt: 1,
      },
    ] as never);
    const { getSessionItems } = await import("./posSessionItems");
    const ctx = buildCtx();

    const rows = await getHandler(getSessionItems)(ctx as never, {
      sessionId: "session-1" as Id<"posSession">,
    });

    expect(rows).toHaveLength(1);
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot change this POS sale.",
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("proves public exports conform to their return validators", () => {
    assertConformsToExportedReturns(getSessionItems, [
      {
        _id: "item-1" as Id<"posSessionItem">,
        _creationTime: 1,
        createdAt: 1,
        price: 12000,
        productId: "product-1" as Id<"product">,
        productName: "Closure Wig",
        productSku: "SKU-1",
        productSkuId: "sku-1" as Id<"productSku">,
        quantity: 1,
        sessionId: "session-1" as Id<"posSession">,
        storeId: "store-1" as Id<"store">,
        updatedAt: 1,
      },
    ]);
    assertConformsToExportedReturns(addOrUpdateItem, {
      kind: "ok",
      data: {
        itemId: "item-1" as Id<"posSessionItem">,
        expiresAt: 1,
      },
    });
    assertConformsToExportedReturns(addOrUpdateItem, {
      kind: "user_error",
      error: {
        code: "not_found",
        message: "This sale is no longer available.",
      },
    });
    assertConformsToExportedReturns(removeItem, {
      kind: "ok",
      data: {
        expiresAt: 1,
      },
    });
  });

  it("does not return session items when authorization fails", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValueOnce(
      new Error("You cannot change this POS sale."),
    );
    const { getSessionItems } = await import("./posSessionItems");

    await expect(
      getHandler(getSessionItems)(buildCtx() as never, {
        sessionId: "session-1" as Id<"posSession">,
      }),
    ).rejects.toThrow("You cannot change this POS sale.");

    expect(collectSessionItemsFromPages).not.toHaveBeenCalled();
  });
});

function buildCtx() {
  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "posSession" && id === "session-1") {
          return {
            _id: "session-1",
            storeId: "store-1",
          };
        }
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

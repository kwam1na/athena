import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

const mocks = vi.hoisted(() => ({
  requirePosApplicationAuthorityWithCtx: vi.fn(),
  runRemoveSessionItemCommand: vi.fn(),
  runUpsertSessionItemCommand: vi.fn(),
}));

vi.mock("../pos/application/posApplicationAuthority", () => ({
  requirePosApplicationAuthorityWithCtx:
    mocks.requirePosApplicationAuthorityWithCtx,
}));

vi.mock("../pos/application/commands/sessionCommands", () => ({
  runRemoveSessionItemCommand: mocks.runRemoveSessionItemCommand,
  runUpsertSessionItemCommand: mocks.runUpsertSessionItemCommand,
}));

vi.mock("../pos/infrastructure/repositories/sessionCommandRepository", () => ({
  collectSessionItemsFromPages: vi.fn(),
}));

import {
  addOrUpdateItem,
  getSessionItems,
  removeItem,
} from "./posSessionItems";
import { collectSessionItemsFromPages } from "../pos/infrastructure/repositories/sessionCommandRepository";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("posSessionItems public mutations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValue({
      storeId: "store-1",
      terminalId: "terminal-1",
    });
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

  it("proves public session-item handlers conform to their return validators", async () => {
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
    const ctx = buildCtx();
    const getResult = await getHandler(getSessionItems)(ctx as never, {
      sessionId: "session-1" as Id<"posSession">,
    });
    const upsertResult = await getHandler(addOrUpdateItem)(ctx as never, {
      barcode: "123",
      price: 12000,
      productId: "product-1" as Id<"product">,
      productName: "Closure Wig",
      productSku: "SKU-1",
      productSkuId: "sku-1" as Id<"productSku">,
      quantity: 1,
      sessionId: "session-1" as Id<"posSession">,
      staffProfileId: "staff-1" as Id<"staffProfile">,
    });
    const removeResult = await getHandler(removeItem)(ctx as never, {
      itemId: "item-1" as Id<"posSessionItem">,
      sessionId: "session-1" as Id<"posSession">,
      staffProfileId: "staff-1" as Id<"staffProfile">,
    });

    expect(() =>
      assertConformsToExportedReturns(getSessionItems, getResult),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(addOrUpdateItem, upsertResult),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(removeItem, removeResult),
    ).not.toThrow();
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

    expect(mocks.requirePosApplicationAuthorityWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        storeId: "store-1",
      },
    );
    expect(mocks.runUpsertSessionItemCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        sessionId: "session-1",
      }),
    );
  });

  it("does not mutate session items when authorization fails", async () => {
    mocks.requirePosApplicationAuthorityWithCtx.mockRejectedValueOnce(
      new Error("The POS application session is no longer authorized."),
    );

    await expect(
      getHandler(removeItem)(buildCtx() as never, {
        itemId: "item-1" as Id<"posSessionItem">,
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
      }),
    ).rejects.toThrow("no longer authorized");

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
    const ctx = buildCtx();

    const rows = await getHandler(getSessionItems)(ctx as never, {
      sessionId: "session-1" as Id<"posSession">,
    });

    expect(rows).toHaveLength(1);
    expect(mocks.requirePosApplicationAuthorityWithCtx).toHaveBeenCalledWith(
      ctx,
      { storeId: "store-1" },
    );
  });

  it("does not return session items when authorization fails", async () => {
    mocks.requirePosApplicationAuthorityWithCtx.mockRejectedValueOnce(
      new Error("The POS application session is no longer authorized."),
    );
    await expect(
      getHandler(getSessionItems)(buildCtx() as never, {
        sessionId: "session-1" as Id<"posSession">,
      }),
    ).rejects.toThrow("no longer authorized");

    expect(collectSessionItemsFromPages).not.toHaveBeenCalled();
  });

  it("denies cross-terminal resource confusion", async () => {
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValueOnce({
      storeId: "store-1",
      terminalId: "terminal-2",
    });

    await expect(
      getHandler(removeItem)(buildCtx() as never, {
        itemId: "item-1" as Id<"posSessionItem">,
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
      }),
    ).rejects.toThrow("no longer authorized");
    expect(mocks.runRemoveSessionItemCommand).not.toHaveBeenCalled();
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
            terminalId: "terminal-1",
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

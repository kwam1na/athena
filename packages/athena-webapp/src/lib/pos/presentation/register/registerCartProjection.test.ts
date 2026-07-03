import { describe, expect, it } from "vitest";

import type { CartItem } from "@/components/pos/types";
import type { PosLocalEventRecord } from "@/lib/pos/infrastructure/local/posLocalStore";
import type { PosLocalRegisterReadModel } from "@/lib/pos/infrastructure/local/registerReadModel";

import {
  buildCatalogRepresentedPendingCheckoutItemIds,
  cartItemsFromLocalRegisterModel,
  mapLocalPendingCheckoutEventsToProducts,
  productCartSourceKey,
  renderedCartLineSourceKey,
} from "./registerCartProjection";

function localEvent(
  overrides: Partial<PosLocalEventRecord>,
): PosLocalEventRecord {
  return {
    createdAt: 1,
    localEventId: "event-1",
    payload: {},
    schemaVersion: 8,
    sequence: 1,
    storeId: "store-1",
    sync: { status: "pending" },
    terminalId: "terminal-1",
    type: "cart.item_added",
    ...overrides,
  } as PosLocalEventRecord;
}

function readModel(
  overrides: Partial<PosLocalRegisterReadModel>,
): PosLocalRegisterReadModel {
  return {
    activeRegisterSession: null,
    activeSale: null,
    canSell: true,
    clearedSaleIds: [],
    closeoutState: null,
    completedSales: [],
    errors: [],
    registerState: {} as PosLocalRegisterReadModel["registerState"],
    sourceEvents: [],
    syncStatus: {
      lastSyncedSequence: 0,
      pendingEventCount: 0,
      status: "idle",
    } as unknown as PosLocalRegisterReadModel["syncStatus"],
    ...overrides,
  };
}

const trustedCartItem = {
  id: "item-1",
  name: "Trusted Wig",
  barcode: "111",
  sku: "SKU-1",
  price: 100,
  quantity: 1,
  productId: "product-1",
  skuId: "sku-1",
} as unknown as CartItem;

describe("registerCartProjection", () => {
  it("separates trusted, provisional import, and pending checkout sources", () => {
    expect(productCartSourceKey({})).toBe("trusted_inventory");
    expect(
      productCartSourceKey({
        inventoryImportProvisionalSkuId: "provisional-1",
      }),
    ).toBe("provisional_import:provisional-1");
    expect(productCartSourceKey({ pendingCheckoutItemId: "pending-1" })).toBe(
      "pending_checkout:pending-1",
    );
    expect(
      productCartSourceKey({
        pendingCheckoutAliasState: "linked_to_catalog",
        pendingCheckoutItemId: "pending-1",
      }),
    ).toBe("trusted_inventory");
    expect(
      renderedCartLineSourceKey({
        ...trustedCartItem,
        pendingCheckoutItemId: "pending-1",
      } as unknown as CartItem),
    ).toBe("pending_checkout:pending-1");
    expect(
      renderedCartLineSourceKey({
        ...trustedCartItem,
        pendingCheckoutAliasState: "linked_to_catalog",
        pendingCheckoutItemId: "pending-1",
      } as unknown as CartItem),
    ).toBe("trusted_inventory");
  });

  it("tracks pending checkout items already represented by catalog rows", () => {
    const representedIds = buildCatalogRepresentedPendingCheckoutItemIds([
      {
        pendingCheckoutItemId: "pending-primary",
        linkedPendingCheckoutItemIds: [
          "pending-linked-1",
          null,
          undefined,
          "pending-linked-2",
        ],
      },
      {
        pendingCheckoutItemId: null,
        linkedPendingCheckoutItemIds: null,
      },
    ]);

    expect([...representedIds].sort()).toEqual([
      "pending-linked-1",
      "pending-linked-2",
      "pending-primary",
    ]);
  });

  it("preserves explicit local removals when merging current cart items", () => {
    const result = cartItemsFromLocalRegisterModel(
      readModel({
        activeSale: {
          items: [],
          localPosSessionId: "local-sale-1",
        } as unknown as PosLocalRegisterReadModel["activeSale"],
        sourceEvents: [
          localEvent({
            localPosSessionId: "local-sale-1",
            payload: {
              localItemId: "item-1",
              localPosSessionId: "local-sale-1",
              productSkuId: "sku-1",
              quantity: 0,
            },
          }),
        ],
      }),
      "local-sale-1",
      [trustedCartItem],
    );

    expect(result).toEqual([]);
  });

  it("keeps linked pending alias local cart items on the trusted source lane", () => {
    const result = cartItemsFromLocalRegisterModel(
      readModel({
        activeSale: {
          items: [
            {
              barcode: "111",
              localItemId: "local-item-1",
              pendingCheckoutAliasState: "linked_to_catalog",
              pendingCheckoutItemId: "pending-1",
              price: 100,
              productId: "product-1",
              productName: "Trusted Wig",
              productSku: "SKU-1",
              productSkuId: "sku-1",
              quantity: 1,
            },
          ],
          localPosSessionId: "local-sale-1",
        } as unknown as PosLocalRegisterReadModel["activeSale"],
      }),
      "local-sale-1",
      [],
    );

    expect(result).toHaveLength(1);
    expect(result?.[0] ? renderedCartLineSourceKey(result[0]) : null).toBe(
      "trusted_inventory",
    );
    expect(result?.[0]).toMatchObject({
      pendingCheckoutAliasState: "linked_to_catalog",
      pendingCheckoutItemId: "pending-1",
      skuId: "sku-1",
    });
  });

  it("lets the latest zero-quantity cart event suppress a stale projected local item", () => {
    const result = cartItemsFromLocalRegisterModel(
      readModel({
        activeSale: {
          items: [
            {
              barcode: "111",
              localItemId: "local-item-1",
              price: 100,
              productId: "product-1",
              productName: "Trusted Wig",
              productSku: "SKU-1",
              productSkuId: "sku-1",
              quantity: 1,
            },
          ],
          localPosSessionId: "local-sale-1",
        } as unknown as PosLocalRegisterReadModel["activeSale"],
        sourceEvents: [
          localEvent({
            localEventId: "event-add",
            localPosSessionId: "local-sale-1",
            payload: {
              localItemId: "local-item-1",
              localPosSessionId: "local-sale-1",
              productSkuId: "sku-1",
              quantity: 1,
            },
            sequence: 1,
          }),
          localEvent({
            localEventId: "event-remove",
            localPosSessionId: "local-sale-1",
            payload: {
              localItemId: "local-item-1",
              localPosSessionId: "local-sale-1",
              productSkuId: "sku-1",
              quantity: 0,
            },
            sequence: 2,
          }),
        ],
      }),
      "local-sale-1",
      [trustedCartItem],
    );

    expect(result).toEqual([]);
  });

  it("rebuilds pending checkout products from local definition and cart events", () => {
    const products = mapLocalPendingCheckoutEventsToProducts([
      localEvent({
        payload: {
          barcode: "LOCAL-1",
          pendingCheckoutItemId: "pending-1",
          productId: "product-local-1",
          productSku: "LOCAL-SKU",
          productSkuId: "sku-local-1",
        },
      }),
      localEvent({
        localEventId: "event-2",
        payload: {
          localPendingCheckoutItemId: "pending-1",
          lookupCode: "LOOKUP-1",
          name: "Uncataloged Item",
          price: 25,
        },
        sequence: 2,
        type: "pending_checkout_item.defined",
      }),
    ]);

    expect(products).toMatchObject([
      {
        barcode: "LOOKUP-1",
        id: "sku-local-1",
        name: "Uncataloged Item",
        pendingCheckoutItemId: "pending-1",
        price: 25,
        sku: "LOCAL-SKU",
      },
    ]);
  });
});

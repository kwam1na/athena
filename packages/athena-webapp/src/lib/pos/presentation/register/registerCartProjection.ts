import type { Id } from "~/convex/_generated/dataModel";

import type { CartItem, Product } from "@/components/pos/types";
import type {
  PosLocalCartItemReadModel,
  PosLocalRegisterReadModel,
} from "@/lib/pos/infrastructure/local/registerReadModel";
import type { PosLocalEventRecord } from "@/lib/pos/infrastructure/local/posLocalStore";

export function mapProductToOptimisticCartItem(
  product: Product,
  quantity: number,
): CartItem {
  return {
    id: `optimistic:${product.id}` as Id<"posSessionItem">,
    name: product.name,
    barcode: product.barcode,
    sku: product.sku,
    price: product.price,
    quantity,
    image: product.image ?? undefined,
    size: product.size,
    length: product.length,
    color: product.color,
    productId: product.productId,
    skuId: product.skuId,
    pendingCheckoutItemId: product.pendingCheckoutItemId,
    pendingCheckoutAliasState: product.pendingCheckoutAliasState,
    inventoryImportProvisionalSkuId: product.inventoryImportProvisionalSkuId,
    areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
  };
}

export function buildLocalCartItemPayload(input: {
  localItemId: string;
  product: Product;
  quantity: number;
}) {
  const { localItemId, product, quantity } = input;
  return {
    localItemId,
    productId: product.productId,
    productSkuId: product.skuId,
    pendingCheckoutItemId: product.pendingCheckoutItemId ?? null,
    pendingCheckoutAliasState: product.pendingCheckoutAliasState ?? null,
    inventoryImportProvisionalSkuId:
      product.inventoryImportProvisionalSkuId ?? null,
    productSku: product.sku || "",
    barcode: product.barcode || null,
    productName: product.name,
    price: product.price,
    quantity,
    quantityAvailable: product.quantityAvailable,
    image: product.image || null,
    size: product.size || null,
    length: product.length || null,
    color: product.color || null,
    areProcessingFeesAbsorbed: product.areProcessingFeesAbsorbed,
  };
}

export function productCartSourceKey(product: {
  pendingCheckoutItemId?: string | null;
  pendingCheckoutAliasState?: "linked_to_catalog" | null;
  inventoryImportProvisionalSkuId?: string | null;
}) {
  if (product.inventoryImportProvisionalSkuId) {
    return `provisional_import:${product.inventoryImportProvisionalSkuId}`;
  }
  if (
    product.pendingCheckoutItemId &&
    product.pendingCheckoutAliasState !== "linked_to_catalog"
  ) {
    return `pending_checkout:${product.pendingCheckoutItemId}`;
  }
  return "trusted_inventory";
}

export function buildCatalogRepresentedPendingCheckoutItemIds(
  rows: readonly {
    pendingCheckoutItemId?: string | null;
    linkedPendingCheckoutItemIds?:
      | readonly (string | null | undefined)[]
      | null;
  }[],
) {
  const ids = new Set<string>();

  for (const row of rows) {
    if (row.pendingCheckoutItemId) {
      ids.add(row.pendingCheckoutItemId);
    }
    for (const linkedId of row.linkedPendingCheckoutItemIds ?? []) {
      if (linkedId) {
        ids.add(linkedId);
      }
    }
  }

  return ids;
}

export function cartLineSourceKey(item: {
  pendingCheckoutItemId?: string | null;
  pendingCheckoutAliasState?: "linked_to_catalog" | null;
  inventoryImportProvisionalSkuId?: string | null;
}) {
  return productCartSourceKey(item);
}

export function renderedCartLineSourceKey(item: CartItem) {
  return productCartSourceKey({
    inventoryImportProvisionalSkuId:
      "inventoryImportProvisionalSkuId" in item
        ? (item.inventoryImportProvisionalSkuId ?? null)
        : null,
    pendingCheckoutItemId:
      "pendingCheckoutItemId" in item
        ? (item.pendingCheckoutItemId ?? null)
        : null,
    pendingCheckoutAliasState:
      "pendingCheckoutAliasState" in item
        ? (item.pendingCheckoutAliasState ?? null)
        : null,
  });
}

export function optimisticCartProductKeyFromCartItem(item: CartItem) {
  const itemId = item.id.toString();
  return itemId.startsWith("optimistic:")
    ? itemId.slice("optimistic:".length)
    : (item.skuId ?? itemId);
}

export function buildLocalCartItemPayloadFromCartItem(input: {
  item: CartItem;
  localItemId: string;
  quantity: number;
}) {
  const { item, localItemId, quantity } = input;
  return {
    localItemId,
    productId: item.productId,
    productSkuId: item.skuId,
    pendingCheckoutItemId:
      "pendingCheckoutItemId" in item
        ? (item.pendingCheckoutItemId ?? null)
        : null,
    pendingCheckoutAliasState:
      "pendingCheckoutAliasState" in item
        ? (item.pendingCheckoutAliasState ?? null)
        : null,
    inventoryImportProvisionalSkuId:
      "inventoryImportProvisionalSkuId" in item
        ? (item.inventoryImportProvisionalSkuId ?? null)
        : null,
    productSku: item.sku || "",
    barcode: item.barcode || null,
    productName: item.name,
    price: item.price,
    quantity,
    image: item.image || null,
    size: item.size || null,
    length: item.length || null,
    color: item.color || null,
    areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
  };
}

export function getProductAvailabilityStatus(product: Product) {
  if (product.availabilityStatus) {
    return product.availabilityStatus;
  }

  if (typeof product.quantityAvailable === "number") {
    return product.inStock && product.quantityAvailable > 0
      ? "available"
      : "out_of_stock";
  }

  return product.inStock ? "available" : "unknown";
}

export function mapLocalCartItemToCartItem(
  item: PosLocalCartItemReadModel,
): CartItem {
  return {
    id: item.localItemId as Id<"posSessionItem">,
    name: item.productName,
    barcode: item.barcode || "",
    sku: item.productSku,
    price: item.price,
    quantity: item.quantity,
    image: item.image,
    size: item.size,
    length: item.length,
    color: item.color,
    productId: item.productId as Id<"product">,
    skuId: item.productSkuId as Id<"productSku">,
    pendingCheckoutItemId: item.pendingCheckoutItemId as
      | Id<"posPendingCheckoutItem">
      | undefined,
    pendingCheckoutAliasState: item.pendingCheckoutAliasState,
    inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId as
      | Id<"inventoryImportProvisionalSku">
      | undefined,
    areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
  };
}

export function normalizePendingCheckoutSearchText(
  value: string | null | undefined,
) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function pendingCheckoutFieldsMatchSearch(
  input: {
    barcode?: string | null;
    name?: string | null;
    productId?: string | null;
    sku?: string | null;
    skuId?: string | null;
  },
  query: string,
) {
  const normalizedQuery = normalizePendingCheckoutSearchText(query);
  if (!normalizedQuery) {
    return false;
  }

  return [
    input.name,
    input.sku,
    input.barcode,
    input.productId,
    input.skuId,
    "pending checkout",
  ].some((value) =>
    normalizePendingCheckoutSearchText(value).includes(normalizedQuery),
  );
}

export function pendingCheckoutCartItemMatchesSearch(
  item: CartItem,
  query: string,
) {
  return pendingCheckoutFieldsMatchSearch(
    {
      barcode: item.barcode,
      name: item.name,
      productId: item.productId?.toString(),
      sku: item.sku,
      skuId: item.skuId?.toString(),
    },
    query,
  );
}

export function mapPendingCheckoutCartItemToProduct(item: CartItem): Product {
  return {
    id: item.skuId?.toString() ?? item.id.toString(),
    name: item.name,
    sku: item.sku ?? "",
    barcode: item.barcode ?? "",
    price: item.price,
    category: "Pending checkout",
    description: "Pending owner review",
    image: item.image ?? null,
    inStock: true,
    availabilityStatus: "available",
    size: item.size,
    length: item.length,
    color: item.color,
    productId: item.productId,
    skuId: item.skuId,
    pendingCheckoutItemId:
      "pendingCheckoutItemId" in item
        ? (item.pendingCheckoutItemId as
            | Id<"posPendingCheckoutItem">
            | undefined)
        : undefined,
    pendingCheckoutAliasState:
      "pendingCheckoutAliasState" in item
        ? item.pendingCheckoutAliasState
        : undefined,
    areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
  };
}

export function mapLocalPendingCheckoutEventsToProducts(
  events: PosLocalEventRecord[],
): Product[] {
  const cartPayloadsByPendingCheckoutItemId = new Map<
    string,
    Record<string, unknown>
  >();
  const productsByPendingCheckoutItemId = new Map<string, Product>();

  for (const event of events) {
    if (event.type !== "cart.item_added") {
      continue;
    }
    const payload = recordOrNull(event.payload);
    const pendingCheckoutItemId = stringFromRecord(
      payload,
      "pendingCheckoutItemId",
    );
    if (!payload || !pendingCheckoutItemId) {
      continue;
    }
    cartPayloadsByPendingCheckoutItemId.set(pendingCheckoutItemId, payload);
  }

  for (const event of events) {
    if (event.type !== "pending_checkout_item.defined") {
      continue;
    }
    const payload = recordOrNull(event.payload);
    const pendingCheckoutItemId = stringFromRecord(
      payload,
      "localPendingCheckoutItemId",
    );
    const name = stringFromRecord(payload, "name");
    const price = numberFromRecord(payload, "price");
    if (!pendingCheckoutItemId || !name || price === undefined) {
      continue;
    }

    const cartPayload =
      cartPayloadsByPendingCheckoutItemId.get(pendingCheckoutItemId) ?? null;
    const productSkuId =
      stringFromRecord(cartPayload, "productSkuId") ??
      `local-pending-sku-${pendingCheckoutItemId}`;
    const productId =
      stringFromRecord(cartPayload, "productId") ??
      `local-pending-product-${pendingCheckoutItemId}`;

    productsByPendingCheckoutItemId.set(pendingCheckoutItemId, {
      id: productSkuId,
      name,
      sku:
        stringFromRecord(cartPayload, "productSku") ??
        formatLocalPendingCheckoutSku(pendingCheckoutItemId),
      barcode:
        stringFromRecord(payload, "lookupCode") ??
        stringFromRecord(cartPayload, "barcode") ??
        "",
      price,
      category: "Pending checkout",
      description: "Pending owner review",
      image: null,
      inStock: true,
      availabilityStatus: "available",
      productId: productId as Id<"product">,
      skuId: productSkuId as Id<"productSku">,
      pendingCheckoutItemId:
        pendingCheckoutItemId as Id<"posPendingCheckoutItem">,
      quantityAvailable: undefined,
    });
  }

  return [...productsByPendingCheckoutItemId.values()];
}

export function formatLocalPendingCheckoutSku(
  localPendingCheckoutItemId: string,
) {
  const code = localPendingCheckoutItemId
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(-10)
    .padStart(10, "0");

  return `${code.slice(0, 4)}-${code.slice(4, 7)}-${code.slice(7, 10)}`;
}

export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function stringFromRecord(
  record: Record<string, unknown> | null,
  key: string,
) {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function numberFromRecord(
  record: Record<string, unknown> | null,
  key: string,
) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function recordFromPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

export function stringFromPayload(
  payload: Record<string, unknown>,
  field: string,
): string {
  const value = payload[field];
  return typeof value === "string" ? value : "";
}

export function cartItemSkuEntry(item: CartItem): readonly [string, CartItem][] {
  const skuId = item.skuId;
  return skuId ? [[skuId.toString(), item]] : [];
}

function cartItemLineEventKey(input: {
  productSkuId?: string | null;
  pendingCheckoutItemId?: string | null;
  pendingCheckoutAliasState?: "linked_to_catalog" | null;
  inventoryImportProvisionalSkuId?: string | null;
}) {
  if (!input.productSkuId) return null;

  return [
    input.productSkuId,
    productCartSourceKey({
      inventoryImportProvisionalSkuId:
        input.inventoryImportProvisionalSkuId ?? null,
      pendingCheckoutItemId: input.pendingCheckoutItemId ?? null,
      pendingCheckoutAliasState: input.pendingCheckoutAliasState ?? null,
    }),
  ].join(":");
}

function cartItemLineKey(item: CartItem) {
  return cartItemLineEventKey({
    productSkuId: item.skuId?.toString(),
    inventoryImportProvisionalSkuId:
      "inventoryImportProvisionalSkuId" in item
        ? (item.inventoryImportProvisionalSkuId?.toString() ?? null)
        : null,
    pendingCheckoutItemId:
      "pendingCheckoutItemId" in item
        ? (item.pendingCheckoutItemId?.toString() ?? null)
        : null,
    pendingCheckoutAliasState:
      "pendingCheckoutAliasState" in item
        ? (item.pendingCheckoutAliasState ?? null)
        : null,
  });
}

export function addLocalAvailabilityConsumption(
  quantities: Map<string, number>,
  item: PosLocalCartItemReadModel,
) {
  if (!item.productSkuId) return;
  if (cartLineSourceKey(item) !== "trusted_inventory") return;

  quantities.set(
    item.productSkuId,
    (quantities.get(item.productSkuId) ?? 0) + item.quantity,
  );
}

export function localPosSessionIdFromEvent(event: {
  localPosSessionId?: string;
  payload: unknown;
}) {
  return (
    event.localPosSessionId ||
    stringFromPayload(recordFromPayload(event.payload), "localPosSessionId")
  );
}

type LocalAvailabilityEventIndexEntry = {
  hasUnsyncedEvents: boolean;
  syncedCartQuantityBySku: Map<string, number>;
};

export function buildLocalAvailabilityEventIndex(
  model: PosLocalRegisterReadModel,
) {
  const index = new Map<string, LocalAvailabilityEventIndexEntry>();
  const lastSyncedSequence = model.syncStatus.lastSyncedSequence;

  for (const event of model.sourceEvents) {
    const localPosSessionId = localPosSessionIdFromEvent(event);
    if (!localPosSessionId) {
      continue;
    }

    const entry = index.get(localPosSessionId) ?? {
      hasUnsyncedEvents: false,
      syncedCartQuantityBySku: new Map<string, number>(),
    };
    index.set(localPosSessionId, entry);

    if (event.sequence > lastSyncedSequence) {
      entry.hasUnsyncedEvents = true;
      continue;
    }

    if (event.type !== "cart.item_added") {
      continue;
    }

    const payload = recordFromPayload(event.payload);
    const productSkuId = stringFromPayload(payload, "productSkuId");
    const quantity = payload.quantity;
    if (!productSkuId || typeof quantity !== "number") {
      continue;
    }

    entry.syncedCartQuantityBySku.set(productSkuId, Math.max(0, quantity));
  }

  return index;
}

export function addLocalAvailabilityDeltaConsumption(input: {
  quantities: Map<string, number>;
  items: PosLocalCartItemReadModel[];
  syncedCartQuantityBySku: Map<string, number>;
}) {
  for (const item of input.items) {
    if (!item.productSkuId) continue;
    if (cartLineSourceKey(item) !== "trusted_inventory") continue;

    const unsyncedQuantity = Math.max(
      0,
      item.quantity -
        (input.syncedCartQuantityBySku.get(item.productSkuId) ?? 0),
    );
    if (unsyncedQuantity <= 0) continue;

    input.quantities.set(
      item.productSkuId,
      (input.quantities.get(item.productSkuId) ?? 0) + unsyncedQuantity,
    );
  }
}

export function localAvailabilityConsumptionFromReadModel(
  model: PosLocalRegisterReadModel | null,
) {
  const quantities = new Map<string, number>();
  if (!model) return quantities;

  const eventIndex = buildLocalAvailabilityEventIndex(model);

  if (model.activeSale) {
    const saleEventIndex = eventIndex.get(model.activeSale.localPosSessionId);
    const hasUnsyncedSaleEvents = Boolean(saleEventIndex?.hasUnsyncedEvents);

    if (!model.activeSale.cloudPosSessionId) {
      for (const item of model.activeSale.items) {
        addLocalAvailabilityConsumption(quantities, item);
      }
    } else if (hasUnsyncedSaleEvents) {
      addLocalAvailabilityDeltaConsumption({
        quantities,
        items: model.activeSale.items,
        syncedCartQuantityBySku:
          saleEventIndex?.syncedCartQuantityBySku ?? new Map<string, number>(),
      });
    }
  }

  for (const sale of model.completedSales) {
    const saleEventIndex = eventIndex.get(sale.localPosSessionId);
    const hasUnsyncedSaleEvents = Boolean(saleEventIndex?.hasUnsyncedEvents);

    if (sale.cloudTransactionId) {
      if (!hasUnsyncedSaleEvents) continue;

      addLocalAvailabilityDeltaConsumption({
        quantities,
        items: sale.items,
        syncedCartQuantityBySku:
          saleEventIndex?.syncedCartQuantityBySku ?? new Map<string, number>(),
      });
    } else {
      for (const item of sale.items) {
        addLocalAvailabilityConsumption(quantities, item);
      }
    }
  }

  return quantities;
}

export function cartItemsFromLocalRegisterModel(
  model: PosLocalRegisterReadModel | null,
  localPosSessionId: string,
  currentCartItems: CartItem[],
) {
  const sale =
    model?.activeSale?.localPosSessionId === localPosSessionId
      ? model.activeSale
      : null;
  if (!model || !sale) return null;

  const localItems = sale.items.map(mapLocalCartItemToCartItem);
  const localItemsBySku = new Map(localItems.flatMap(cartItemSkuEntry));
  const removedCartLineKeys = new Set<string>();
  const removedLocalItemIds = new Set<string>();

  for (const event of model.sourceEvents) {
    if (event.type !== "cart.item_added") continue;
    const payload = recordFromPayload(event.payload);
    const eventLocalPosSessionId =
      event.localPosSessionId ||
      stringFromPayload(payload, "localPosSessionId");
    if (eventLocalPosSessionId !== localPosSessionId) continue;

    const productSkuId = stringFromPayload(payload, "productSkuId");
    const localItemId = stringFromPayload(payload, "localItemId");
    const lineKey = cartItemLineEventKey({
      productSkuId,
      inventoryImportProvisionalSkuId: stringFromPayload(
        payload,
        "inventoryImportProvisionalSkuId",
      ),
      pendingCheckoutItemId: stringFromPayload(payload, "pendingCheckoutItemId"),
      pendingCheckoutAliasState:
        stringFromPayload(payload, "pendingCheckoutAliasState") ===
        "linked_to_catalog"
          ? "linked_to_catalog"
          : null,
    });
    const quantity = payload.quantity;
    if ((!productSkuId && !localItemId) || typeof quantity !== "number") {
      continue;
    }

    if (quantity <= 0) {
      if (lineKey) removedCartLineKeys.add(lineKey);
      if (localItemId) removedLocalItemIds.add(localItemId);
    } else {
      if (lineKey) removedCartLineKeys.delete(lineKey);
      removedLocalItemIds.delete(localItemId);
    }
  }

  const mergedItemsBySku = new Map(
    currentCartItems.flatMap((item) => {
      const skuId = item.skuId;
      if (!skuId) return [];
      const lineKey = cartItemLineKey(item);
      if (lineKey && removedCartLineKeys.has(lineKey)) return [];
      if (removedLocalItemIds.has(item.id.toString())) return [];
      return cartItemSkuEntry(item);
    }),
  );
  for (const [skuId, item] of localItemsBySku) {
    const lineKey = cartItemLineKey(item);
    if (lineKey && removedCartLineKeys.has(lineKey)) {
      mergedItemsBySku.delete(skuId);
      continue;
    }
    mergedItemsBySku.set(skuId, item);
  }

  return Array.from(mergedItemsBySku.values());
}

export function totalsFromCartItems(cartItems: CartItem[]) {
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  return { subtotal, tax: 0, total: subtotal };
}

export function mergeCartItemsBySku(
  baseItems: CartItem[],
  overlayItems: CartItem[],
): CartItem[] {
  const mergedItemsBySku = new Map(baseItems.flatMap(cartItemSkuEntry));

  for (const item of overlayItems) {
    const skuId = item.skuId;
    if (!skuId) continue;
    mergedItemsBySku.set(skuId.toString(), item);
  }

  return Array.from(mergedItemsBySku.values());
}

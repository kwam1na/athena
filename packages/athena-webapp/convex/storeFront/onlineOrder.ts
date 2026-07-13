/* eslint-disable @convex-dev/no-collect-in-query -- V26-168 converts the primary commerce access paths to indexed or bounded reads first; remaining legacy scans in this large module will be reduced in follow-up passes. */
import { v } from "convex/values";
import {
  getSharedDemoActorWithCtx,
  requireSharedDemoCapabilityIfApplicable,
  requireSharedDemoStoreReadIfApplicable,
} from "../sharedDemo/actor";
import { decideSharedDemoEffect, requireSharedDemoOrderFulfillmentUpdate } from "../sharedDemo/policy";
import { requireReadySharedDemoWriteWithCtx } from "../sharedDemo/restore";
import {
  internalMutation,
  internalQuery,
  mutation,
  MutationCtx,
  QueryCtx,
  query,
} from "../_generated/server";
import {
  addressSchema,
  customerDetailsSchema,
  paymentMethodSchema,
} from "../schemas/storeFront";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { getDiscountValue } from "../inventory/utils";
import { buildApprovalRequest } from "../operations/approvalRequestHelpers";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { recordPaymentAllocationWithCtx } from "../operations/paymentAllocations";
import { markCatalogSummaryNeedsRefresh } from "../inventory/catalogSummary";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  createOrderFromCheckoutSession,
  findOrderByExternalReference,
  findOrderByExternalTransactionId,
  returnOrderItemsToStock,
} from "./helpers/onlineOrder";
import {
  assertValidOnlineOrderStatusTransition,
  getOnlineOrderPaymentAmount,
  getOnlineOrderPaymentMethodLabel,
  recordOnlineOrderPaymentCollected,
  recordOnlineOrderPaymentVerified,
  recordOnlineOrderStatusEvent,
} from "./helpers/orderOperations";
import {
  buildOnlineOrderReportedReturns,
  buildOnlineOrderReturnExchangePlan,
} from "./helpers/returnExchangeOperations";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import {
  getRemainingRefundableBalance,
  resolveRefundAmount,
} from "./helpers/paymentHelpers";
import {
  recordOnlineOrderReturnExchangeTraceBestEffort,
  recordOnlineOrderTraceBestEffort,
} from "./onlineOrderTracing";
import { getWorkflowTraceByLookupWithCtx } from "../workflowTraces/core";
import {
  buildSafeExternalReferenceRef,
  ONLINE_ORDER_LOOKUP_TYPES,
  ONLINE_ORDER_WORKFLOW_TYPE,
} from "../workflowTraces/adapters/onlineOrder";
import {
  ORDER_RETURN_EXCHANGE_LOOKUP_TYPES,
  ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE,
} from "../workflowTraces/adapters/orderReturnExchange";
import {
  appendReportingIngressWithCtx,
  type ReportingIngressLineInput,
} from "../reporting/ingress";
import { canonicalReportingBusinessEventKey } from "../reporting/factIdentity";
import {
  applyCommerceInventoryEffectWithCtx,
  outboundBasisFromEffect,
  reportingLineCostFromEffect,
} from "../reporting/inventory/commerceEffects";

const entity = "onlineOrder";
const MAX_ORDER_ITEMS = 200;
const MAX_ORDERS = 500;
const MAX_OPERATIONAL_EVENTS = 20;
const MAX_PENDING_APPROVALS = 100;

async function getWorkflowTraceIdForLookup(
  ctx: QueryCtx,
  args: {
    lookupType: string;
    lookupValue: string;
    storeId: Id<"store">;
    workflowType: string;
  },
) {
  const trace = await getWorkflowTraceByLookupWithCtx(ctx, args);
  return trace?.traceId;
}
type SignedInAthenaUser = {
  id: Id<"athenaUser">;
  email: string;
};

async function listOrderItems(
  ctx: QueryCtx | MutationCtx,
  orderId: Id<"onlineOrder">,
): Promise<Doc<"onlineOrderItem">[]> {
  return await ctx.db
    .query("onlineOrderItem")
    .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
    .take(MAX_ORDER_ITEMS);
}

function appendTransition(
  transitions: Array<{
    status: string;
    date: number;
    signedInAthenaUser?: SignedInAthenaUser;
  }>,
  status: string,
  signedInAthenaUser: SignedInAthenaUser | undefined,
  date: number
) {
  if (transitions[transitions.length - 1]?.status === status) {
    return transitions;
  }

  return [
    ...transitions,
    {
      status,
      date,
      signedInAthenaUser,
    },
  ];
}

function allocateMinorAmounts(total: number, weights: number[]): number[] {
  const safeTotal = Math.max(0, Math.round(total));
  const totalWeight = weights.reduce(
    (sum, weight) => sum + Math.max(0, Math.round(weight)),
    0,
  );
  if (weights.length === 0) return [];
  if (totalWeight === 0) {
    return weights.map((_, index) => (index === 0 ? safeTotal : 0));
  }

  let remainingAmount = safeTotal;
  let remainingWeight = totalWeight;
  return weights.map((weight, index) => {
    const normalizedWeight = Math.max(0, Math.round(weight));
    const amount =
      index === weights.length - 1
        ? remainingAmount
        : Math.round(
            (remainingAmount * normalizedWeight) / remainingWeight,
          );
    remainingAmount -= amount;
    remainingWeight -= normalizedWeight;
    return amount;
  });
}

function storefrontCurrency(currency: string | undefined) {
  const currencyCode = currency?.trim().toUpperCase();
  return currencyCode
    ? { currencyCode, currencyMinorUnitScale: 2 }
    : {};
}

function buildStorefrontFulfillmentLines(args: {
  costByItemId?: Map<
    string,
    Pick<
      ReportingIngressLineInput,
      | "cogsKnownMinor"
      | "cogsKnownQuantity"
      | "cogsUncoveredQuantity"
      | "costStatus"
      | "inventoryEffectId"
      | "valuationCurrencyCode"
      | "valuationCurrencyMinorUnitScale"
    >
  >;
  deliveryFee: number;
  discountAmount: number;
  items: Doc<"onlineOrderItem">[];
  productByItemId?: Map<string, Doc<"product">>;
}): ReportingIngressLineInput[] {
  const merchandiseGross = args.items.map((item) => item.price * item.quantity);
  const discounts = allocateMinorAmounts(
    args.discountAmount,
    merchandiseGross,
  );
  const lines: ReportingIngressLineInput[] = args.items.map((item, index) => {
    const product = args.productByItemId?.get(String(item._id));
    const recognizedNetAmountMinor =
      merchandiseGross[index] - discounts[index];
    return {
      ...(args.costByItemId?.get(String(item._id)) ?? {
        costStatus: "unknown" as const,
      }),
      allocatedDiscountMinor: discounts[index],
      attributionKind: "direct",
      canonicalProductSkuId: item.productSkuId,
      categoryId: product?.categoryId,
      channel: "storefront",
      discountAmountMinor: discounts[index],
      grossAmountMinor: merchandiseGross[index],
      lineKey: String(item._id),
      lineKind: "merchandise",
      netAmountMinor: recognizedNetAmountMinor,
      originalProductSkuId: item.productSkuId,
      originalQuantity: item.quantity,
      productId: item.productId,
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      recognizedNetAmountMinor,
      recognitionCategoryId: product?.categoryId,
      recognitionProductId: item.productId,
      recognitionProductSkuId: item.productSkuId,
      unitPriceMinor: item.price,
    };
  });
  if (args.deliveryFee > 0) {
    lines.push({
      costStatus: "not_applicable",
      allocatedDiscountMinor: 0,
      channel: "storefront",
      discountAmountMinor: 0,
      grossAmountMinor: args.deliveryFee,
      lineKey: "delivery",
      lineKind: "delivery",
      netAmountMinor: args.deliveryFee,
      quantity: 0,
      originalQuantity: 0,
      recognizedNetAmountMinor: args.deliveryFee,
    });
  }
  return lines;
}

function buildStorefrontRefundLines(args: {
  deliveryFee: number;
  items: Array<
    Pick<
      Doc<"onlineOrderItem">,
      "_id" | "price" | "productId" | "productSkuId" | "quantity"
    >
  >;
  refundAmount: number;
}): ReportingIngressLineInput[] {
  const components: Array<{
    key: string;
    kind: "delivery" | "merchandise";
    productId?: Id<"product">;
    productSkuId?: Id<"productSku">;
    weight: number;
  }> = [
    ...args.items.map((item) => ({
      key: String(item._id),
      kind: "merchandise" as const,
      productId: item.productId,
      productSkuId: item.productSkuId,
      weight: item.price * item.quantity,
    })),
    ...(args.deliveryFee > 0
      ? [
          {
            key: "delivery",
            kind: "delivery" as const,
            productId: undefined,
            productSkuId: undefined,
            weight: args.deliveryFee,
          },
        ]
      : []),
  ];
  if (components.length === 0) {
    components.push({
      key: "refund",
      kind: "merchandise",
      productId: undefined,
      productSkuId: undefined,
      weight: args.refundAmount,
    });
  }
  const allocations = allocateMinorAmounts(
    args.refundAmount,
    components.map((component) => component.weight),
  );
  return components.map((component, index) => ({
    costStatus:
      component.kind === "merchandise" ? "unknown" : "not_applicable",
    discountAmountMinor: 0,
    allocatedDiscountMinor: 0,
    attributionKind: component.productSkuId ? "direct" : undefined,
    canonicalProductSkuId: component.productSkuId,
    channel: "storefront",
    grossAmountMinor: allocations[index],
    lineKey: component.key,
    lineKind: component.kind,
    netAmountMinor: allocations[index],
    ...(component.productSkuId
      ? { productSkuId: component.productSkuId }
      : {}),
    quantity: 0,
    originalProductSkuId: component.productSkuId,
    originalQuantity: 0,
    productId: component.productId,
    recognizedNetAmountMinor: allocations[index],
    recognitionProductId: component.productId,
    recognitionProductSkuId: component.productSkuId,
  }));
}

async function applyOnlineOrderUpdate(
  ctx: MutationCtx,
  order: Doc<"onlineOrder">,
  args: {
    registerSessionId?: Id<"registerSession">;
    returnItemsToStock?: boolean;
    signedInAthenaUser?: SignedInAthenaUser;
    update: Record<string, any>;
    allowUncollectedPaymentOnDelivery?: boolean;
  }
) {
  const nextStatus =
    typeof args.update.status === "string" ? args.update.status : undefined;
  const statusChanged = Boolean(nextStatus && nextStatus !== order.status);
  const paymentCollectedChanged =
    args.update.paymentCollected === true && !order.paymentCollected;
  const paymentVerifiedChanged =
    args.update.hasVerifiedPayment === true && !order.hasVerifiedPayment;
  const nextPaymentCollected =
    typeof args.update.paymentCollected === "boolean"
      ? args.update.paymentCollected
      : order.paymentCollected;
  const now = Date.now();
  const baseTransitions = Array.isArray(args.update.transitions)
    ? [...args.update.transitions]
    : [...(order.transitions ?? [])];
  let updates = { ...args.update };

  if (statusChanged) {
    assertValidOnlineOrderStatusTransition(
      {
        ...order,
        paymentCollected: nextPaymentCollected,
      },
      nextStatus!,
      {
        allowUncollectedPaymentOnDelivery:
          args.allowUncollectedPaymentOnDelivery,
      },
    );

    updates.transitions = appendTransition(
      baseTransitions,
      nextStatus!,
      args.signedInAthenaUser,
      now
    );

    if (nextStatus === "cancelled" && args.returnItemsToStock !== false) {
      await returnOrderItemsToStock(ctx, order._id);
    }
  }

  if (paymentCollectedChanged) {
    updates.transitions = appendTransition(
      updates.transitions ?? baseTransitions,
      "payment_collected",
      args.signedInAthenaUser,
      now
    );
  }

  const readyStatuses = ["ready-for-pickup", "ready-for-delivery"];
  if (statusChanged && readyStatuses.includes(nextStatus!)) {
    updates.readyAt = now;
  }

  const completedStatuses = ["delivered", "picked-up"];
  if (statusChanged && completedStatuses.includes(nextStatus!)) {
    updates.completedAt = now;
  }

  const shouldSendOrderUpdateEmail =
    statusChanged &&
    [
      ...completedStatuses,
      "ready-for-pickup",
      "out-for-delivery",
      "cancelled",
    ].includes(nextStatus!);

  if (shouldSendOrderUpdateEmail) {
    const demoActor = await getSharedDemoActorWithCtx(ctx);
    if (demoActor) {
      await decideSharedDemoEffect("order_notification.send", {
        live: async () => ctx.scheduler.runAfter(0, internal.storeFront.onlineOrderUtilFns.sendOrderUpdateEmailInternal, { orderId: order._id, newStatus: nextStatus! }),
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.storeFront.onlineOrderUtilFns.sendOrderUpdateEmailInternal, { orderId: order._id, newStatus: nextStatus! });
    }
  }

  await ctx.db.patch("onlineOrder", order._id, updates);

  const nextOrder = {
    ...order,
    ...updates,
  } as Doc<"onlineOrder">;

  if (statusChanged) {
    await recordOnlineOrderStatusEvent(ctx, {
      nextStatus: nextStatus!,
      order: nextOrder,
      previousStatus: order.status,
      signedInAthenaUser: args.signedInAthenaUser,
    });
    await recordOnlineOrderTraceBestEffort(ctx, {
      nextStatus: nextStatus!,
      order: nextOrder,
      previousStatus: order.status,
      signedInAthenaUser: args.signedInAthenaUser,
      stage: "statusChanged",
    });

    if (
      completedStatuses.includes(nextStatus!) &&
      !completedStatuses.includes(order.status)
    ) {
      const [items, store] = await Promise.all([
        listOrderItems(ctx, order._id),
        ctx.db.get("store", order.storeId),
      ]);
      if (store?.organizationId) {
        const deliveryFee = Math.max(0, Math.round(nextOrder.deliveryFee ?? 0));
        const discountAmount = Math.max(
          0,
          Math.round(getDiscountValue(items, nextOrder.discount)),
        );
        const inventoryEffects = await Promise.all(
          items.map((item) =>
            ctx.db
              .query("reportingInventoryEffect")
              .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
                q
                  .eq("storeId", order.storeId)
                  .eq("sourceDomain", "storefront")
                  .eq(
                    "businessEventKey",
                    `storefront:${order._id}:line:${item._id}:fulfillment`,
                  ),
              )
              .first(),
          ),
        );
        const products = await Promise.all(
          items.map((item) => ctx.db.get("product", item.productId)),
        );
        const costByItemId = new Map(
          items.map((item, index) => {
            const effect = inventoryEffects[index];
            return [
              String(item._id),
              {
                ...reportingLineCostFromEffect(effect, item.quantity),
                ...(effect ? { inventoryEffectId: effect._id } : {}),
              },
            ];
          }),
        );
        const lines = buildStorefrontFulfillmentLines({
          costByItemId,
          deliveryFee,
          discountAmount,
          items,
          productByItemId: new Map(
            items.flatMap((item, index) => {
              const product = products[index];
              return product ? [[String(item._id), product] as const] : [];
            }),
          ),
        });
        await appendReportingIngressWithCtx(ctx, {
          acceptedAt: now,
          adapterVersion: 1,
          businessEventKey: canonicalReportingBusinessEventKey({
            kind: "storefront_fulfillment",
            orderId: String(order._id),
          }),
          contentFingerprint: [
            "storefront-fulfilled-v1",
            String(order._id),
            nextStatus!,
            String(nextOrder.amount),
            String(deliveryFee),
            String(discountAmount),
            ...lines.flatMap((line) => [
              line.lineKey,
              String(line.productId),
              String(line.productSkuId),
              String(line.recognitionCategoryId),
              String(line.quantity),
              String(line.unitPriceMinor),
              String(line.allocatedDiscountMinor),
              String(line.netAmountMinor),
            ]),
          ].join(":"),
          discountAmountMinor: discountAmount,
          grossAmountMinor: nextOrder.amount + deliveryFee,
          lines,
          materialFields: [
            "amountMinor",
            "occurrenceAt",
            "quantity",
            "storeId",
          ],
          netAmountMinor: getOnlineOrderPaymentAmount(nextOrder),
          occurredAt: now,
          organizationId: store.organizationId,
          quantity: items.reduce((sum, item) => sum + item.quantity, 0),
          sourceDomain: "storefront",
          sourceEventType: "storefront_fulfilled",
          sourceReferences: [
            {
              relation: "owns",
              sourceId: String(order._id),
              sourceType: "online_order",
            },
          ],
          storeId: order.storeId,
          ...storefrontCurrency(store.currency),
        });
      }
    }
  }

  if (paymentVerifiedChanged) {
    await recordOnlineOrderPaymentVerified(ctx, {
      order: nextOrder,
      signedInAthenaUser: args.signedInAthenaUser,
    });
    await recordOnlineOrderTraceBestEffort(ctx, {
      amount: getOnlineOrderPaymentAmount(nextOrder),
      order: nextOrder,
      paymentMethod: getOnlineOrderPaymentMethodLabel(nextOrder),
      signedInAthenaUser: args.signedInAthenaUser,
      stage: "paymentVerified",
    });
  }

  if (paymentCollectedChanged) {
    await recordOnlineOrderPaymentCollected(ctx, {
      order: nextOrder,
      registerSessionId: args.registerSessionId,
      signedInAthenaUser: args.signedInAthenaUser,
    });
    await recordOnlineOrderTraceBestEffort(ctx, {
      amount: getOnlineOrderPaymentAmount(nextOrder),
      order: nextOrder,
      paymentMethod: getOnlineOrderPaymentMethodLabel(nextOrder),
      registerSessionId: args.registerSessionId,
      signedInAthenaUser: args.signedInAthenaUser,
      stage: "paymentCollected",
    });
  }

  return nextOrder;
}

function buildReturnExchangeReplacementSourceId(
  orderId: Id<"onlineOrder">,
  productSkuId: Id<"productSku">,
  index: number,
) {
  return `${orderId}:${productSkuId}:exchange:${index}`;
}

function buildReturnExchangeReturnSourceId(
  orderId: Id<"onlineOrder">,
  orderItemId: Id<"onlineOrderItem">,
) {
  return `${orderId}:${orderItemId}:return`;
}

function mapUpdateOrderError(error: unknown): CommandResult<never> | null {
  const message = error instanceof Error ? error.message : "";

  if (
    message.startsWith("Order is already completed as ") ||
    message ===
      "Pickup exceptions can only be recorded after the order is ready for pickup." ||
    message ===
      "Return the order to ready for pickup before completing the pickup." ||
    message ===
      "Collect payment before marking this pickup order as picked up."
  ) {
    return userError({
      code: "precondition_failed",
      message,
    });
  }

  return null;
}

export const create = mutation({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    billingDetails: v.union(
      v.object({
        ...addressSchema.fields,
        billingAddressSameAsDelivery: v.optional(v.boolean()),
      }),
      v.null(),
    ),
    customerDetails: customerDetailsSchema,
    deliveryDetails: v.union(addressSchema, v.null(), v.string()),
    deliveryMethod: v.string(),
    deliveryOption: v.union(v.string(), v.null()),
    deliveryInstructions: v.union(v.string(), v.null()),
    deliveryFee: v.union(v.number(), v.null()),
    discount: v.union(v.record(v.string(), v.any()), v.null()),
    pickupLocation: v.union(v.string(), v.null()),
    paymentMethod: v.optional(paymentMethodSchema),
  },
  handler: async (ctx, args) => {
    return await createOrderFromCheckoutSession(ctx, {
      checkoutSessionId: args.checkoutSessionId,
      billingDetails: args.billingDetails,
      customerDetails: args.customerDetails,
      deliveryDetails: args.deliveryDetails,
      deliveryInstructions: args.deliveryInstructions,
      deliveryMethod: args.deliveryMethod,
      deliveryOption: args.deliveryOption,
      deliveryFee: args.deliveryFee,
      discount: args.discount,
      pickupLocation: args.pickupLocation,
      paymentMethod: args.paymentMethod,
    });
  },
});

export const createInternal = internalMutation({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    billingDetails: v.union(
      v.object({
        ...addressSchema.fields,
        billingAddressSameAsDelivery: v.optional(v.boolean()),
      }),
      v.null(),
    ),
    customerDetails: customerDetailsSchema,
    deliveryDetails: v.union(addressSchema, v.null(), v.string()),
    deliveryMethod: v.string(),
    deliveryOption: v.union(v.string(), v.null()),
    deliveryInstructions: v.union(v.string(), v.null()),
    deliveryFee: v.union(v.number(), v.null()),
    discount: v.union(v.record(v.string(), v.any()), v.null()),
    pickupLocation: v.union(v.string(), v.null()),
    paymentMethod: v.optional(paymentMethodSchema),
  },
  handler: async (ctx, args) => {
    return await createOrderFromCheckoutSession(ctx, {
      checkoutSessionId: args.checkoutSessionId,
      billingDetails: args.billingDetails,
      customerDetails: args.customerDetails,
      deliveryDetails: args.deliveryDetails,
      deliveryInstructions: args.deliveryInstructions,
      deliveryMethod: args.deliveryMethod,
      deliveryOption: args.deliveryOption,
      deliveryFee: args.deliveryFee,
      discount: args.discount,
      pickupLocation: args.pickupLocation,
      paymentMethod: args.paymentMethod,
    });
  },
});

export const createFromSession = internalMutation({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    externalTransactionId: v.string(),
    paymentMethod: v.optional(paymentMethodSchema),
  },
  handler: async (ctx, args) => {
    return await createOrderFromCheckoutSession(ctx, {
      checkoutSessionId: args.checkoutSessionId,
      externalTransactionId: args.externalTransactionId,
      paymentMethod: args.paymentMethod,
      patchSessionPlacedOrderId: true,
      clearBag: true,
    });
  },
});

export const getAll = query({
  args: { storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")) },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId),
      )
      .order("desc")
      .take(MAX_ORDERS);

    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await listOrderItems(ctx, order._id);
        return { ...order, items };
      }),
    );
    const ordersWithItemsAndImages = await Promise.all(
      ordersWithItems.map(async (order) => {
        const itemsWithImages = await Promise.all(
          order.items.map(async (item) => {
            const [product, productSku] = await Promise.all([
              ctx.db.get("product", item.productId),
              ctx.db.get("productSku", item.productSkuId),
            ]);

            return {
              ...item,
              productName: product?.name,
              productImage: productSku?.images?.[0] ?? null,
            };
          }),
        );
        return { ...order, items: itemsWithImages };
      }),
    );
    return ordersWithItemsAndImages;
  },
});

export const get = query({
  args: {
    identifier: v.union(v.id("onlineOrder"), v.string()),
  },
  handler: async (ctx, args) => {
    let order: Doc<"onlineOrder"> | null = null;

    try {
      order = await ctx.db.get(
        "onlineOrder",
        args.identifier as Id<"onlineOrder">,
      );
    } catch (e) {
      order = await ctx.db
        .query(entity)
        .withIndex("by_externalReference", (q) =>
          q.eq("externalReference", args.identifier as string),
        )
        .first();
    }

    if (!order) {
      order = await ctx.db
        .query(entity)
        .withIndex("by_checkoutSessionId", (q) =>
          q.eq("checkoutSessionId", args.identifier as Id<"checkoutSession">),
        )
        .first();
    }

    if (!order) return null;

    await requireSharedDemoStoreReadIfApplicable(ctx, order.storeId);

    const items = await listOrderItems(ctx, order._id);

    const itemsWithImages = await Promise.all(
      items.map(async (item) => {
        const [product, productSku] = await Promise.all([
          ctx.db.get("product", item.productId),
          ctx.db.get("productSku", item.productSkuId),
        ]);

        let category: string | undefined;

        let colorName;

        if (productSku?.color) {
          const color = await ctx.db.get("color", productSku.color);
          colorName = color?.name;
        }

        if (product) {
          const productCategory = await ctx.db.get(
            "category",
            product.categoryId,
          );
          category = productCategory?.name;
        }

        // Calculate stock status
        const currentQuantityAvailable = productSku?.quantityAvailable ?? 0;
        const isOutOfStock = productSku?.inventoryCount === 0;
        const isLowStock =
          (currentQuantityAvailable <= 2 && currentQuantityAvailable > 0) ||
          (productSku?.inventoryCount ?? 0) <= 2;

        return {
          ...item,
          productCategory: category,
          length: productSku?.length,
          colorName,
          productName: product?.name,
          productImage: productSku?.images?.[0],
          // Stock information
          currentQuantityAvailable,
          currentInventoryCount: productSku?.inventoryCount ?? 0,
          isOutOfStock,
          isLowStock,
        };
      }),
    );

    const [workflowTraceId, refundsWithTraceIds] = await Promise.all([
      getWorkflowTraceIdForLookup(ctx, {
        storeId: order.storeId,
        workflowType: ONLINE_ORDER_WORKFLOW_TYPE,
        lookupType: ONLINE_ORDER_LOOKUP_TYPES.orderId,
        lookupValue: order._id,
      }),
      Promise.all(
        (order.refunds ?? []).map(async (refund) => {
          const safeRefundRef = buildSafeExternalReferenceRef(refund.id);

          return {
            ...refund,
            workflowTraceId: safeRefundRef
              ? await getWorkflowTraceIdForLookup(ctx, {
                  storeId: order.storeId,
                  workflowType: ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE,
                  lookupType: ORDER_RETURN_EXCHANGE_LOOKUP_TYPES.subflowRef,
                  lookupValue: `${order._id}:${safeRefundRef}`,
                })
              : undefined,
          };
        }),
      ),
    ]);

    return {
      ...order,
      items: itemsWithImages,
      refunds: refundsWithTraceIds,
      workflowTraceId,
    };
  },
});

export const getInternal = internalQuery({
  args: {
    identifier: v.union(v.id("onlineOrder"), v.string()),
  },
  handler: async (ctx, args) => {
    let order =
      (await ctx.db.get("onlineOrder", args.identifier as Id<"onlineOrder">)) ??
      null;

    if (!order) {
      order = await ctx.db
        .query(entity)
        .withIndex("by_externalReference", (q) =>
          q.eq("externalReference", args.identifier as string),
        )
        .first();
    }

    if (!order) {
      order = await ctx.db
        .query(entity)
        .withIndex("by_checkoutSessionId", (q) =>
          q.eq("checkoutSessionId", args.identifier as Id<"checkoutSession">),
        )
        .first();
    }

    if (!order) return null;

    const items = await listOrderItems(ctx, order._id);

    const itemsWithImages = await Promise.all(
      items.map(async (item) => {
        const [product, productSku] = await Promise.all([
          ctx.db.get("product", item.productId),
          ctx.db.get("productSku", item.productSkuId),
        ]);

        let category: string | undefined;
        let colorName;

        if (productSku?.color) {
          const color = await ctx.db.get("color", productSku.color);
          colorName = color?.name;
        }

        if (product) {
          const productCategory = await ctx.db.get(
            "category",
            product.categoryId,
          );
          category = productCategory?.name;
        }

        const currentQuantityAvailable = productSku?.quantityAvailable ?? 0;
        const isOutOfStock = productSku?.inventoryCount === 0;
        const isLowStock =
          (currentQuantityAvailable <= 2 && currentQuantityAvailable > 0) ||
          (productSku?.inventoryCount ?? 0) <= 2;

        return {
          ...item,
          productCategory: category,
          length: productSku?.length,
          colorName,
          productName: product?.name,
          productImage: productSku?.images?.[0],
          currentQuantityAvailable,
          currentInventoryCount: productSku?.inventoryCount ?? 0,
          isOutOfStock,
          isLowStock,
        };
      }),
    );

    return { ...order, items: itemsWithImages };
  },
});

export const getByExternalReference = query({
  args: { externalReference: v.string() },
  handler: (ctx, args) => findOrderByExternalReference(ctx, args.externalReference),
});

export const getByExternalTransactionId = internalQuery({
  args: { externalTransactionId: v.string() },
  handler: (ctx, args) =>
    findOrderByExternalTransactionId(ctx, args.externalTransactionId),
});

export const getByCheckoutSessionId = query({
  args: { checkoutSessionId: v.id("checkoutSession") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .withIndex("by_checkoutSessionId", (q) =>
        q.eq("checkoutSessionId", args.checkoutSessionId),
      )
      .first();
  },
});

export const getAllOnlineOrders = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    const demoActor = await getSharedDemoActorWithCtx(ctx);
    if (demoActor && args.storeId !== demoActor.storeId) return [];
    const orders = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(MAX_ORDERS);

    // Include items for net amount calculation
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await listOrderItems(ctx, order._id);

        return { ...order, items };
      }),
    );

    return ordersWithItems;
  },
});

export const getAllOnlineOrdersByStoreFrontUserId = query({
  args: { storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")) },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId),
      )
      .order("desc")
      .take(MAX_ORDERS);

    return orders;
  },
});

export const update = mutation({
  args: {
    orderId: v.optional(v.id("onlineOrder")),
    externalReference: v.optional(v.string()),
    registerSessionId: v.optional(v.id("registerSession")),
    update: v.record(v.string(), v.any()),
    returnItemsToStock: v.optional(v.boolean()),
    signedInAthenaUser: v.optional(
      v.object({
        id: v.id("athenaUser"),
        email: v.string(),
      }),
    ),
  },
  returns: commandResultValidator(v.null()),
  handler: async (ctx, args) => {
    try {
      const demoActor = await requireSharedDemoCapabilityIfApplicable(
        ctx,
        "orders.fulfill",
      );
      if (demoActor) {
        requireSharedDemoOrderFulfillmentUpdate(args.update);
        await requireReadySharedDemoWriteWithCtx(ctx, { storeId: demoActor.storeId });
      }
      if (args.orderId) {
        const order = await ctx.db.get("onlineOrder", args.orderId);

        if (!order) {
          return userError({
            code: "not_found",
            message: "Order not found.",
          });
        }
        if (demoActor && order.storeId !== demoActor.storeId) {
          throw new Error("This action is unavailable in the shared demo.");
        }

        await applyOnlineOrderUpdate(ctx, order, {
          ...args,
          allowUncollectedPaymentOnDelivery: Boolean(demoActor),
        });
        return ok(null);
      }

      // external reference is passed in as args from the verifyPayment action
      if (args.externalReference) {
        const order = await findOrderByExternalReference(
          ctx,
          args.externalReference
        );

        if (!order) {
          return userError({
            code: "not_found",
            message: "Order not found.",
          });
        }
        if (demoActor && order.storeId !== demoActor.storeId) {
          throw new Error("This action is unavailable in the shared demo.");
        }

        const { refund_id, refund_amount, ...rest } = args.update;

        const refunds = [
          ...(order.refunds ?? []),
          ...(refund_id && refund_amount
            ? [
                {
                  id: refund_id,
                  amount: refund_amount,
                  date: Date.now(),
                  signedInAthenaUser: args.signedInAthenaUser,
                },
              ]
            : []),
        ];

        if (args.update.status) {
          await applyOnlineOrderUpdate(ctx, order, {
            ...args,
            allowUncollectedPaymentOnDelivery: Boolean(demoActor),
            update: {
              ...rest,
              refunds,
            },
          });
        } else {
          await ctx.db.patch("onlineOrder", order._id, { ...rest, refunds });
        }

        return ok(null);
      }

      return userError({
        code: "validation_failed",
        message: "Order identifier is required.",
      });
    } catch (error) {
      const result = mapUpdateOrderError(error);

      if (result) {
        return result;
      }

      throw error;
    }
  },
});

export const getUnverifiedPaidOrders = internalQuery({
  args: {},
  handler: async (ctx) => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    return await ctx.db
      .query("onlineOrder")
      .filter((q) =>
        q.and(
          q.neq(q.field("hasVerifiedPayment"), true),
          q.lt(q.field("_creationTime"), fiveMinutesAgo),
        ),
      )
      .collect();
  },
});

export const updateInternal = internalMutation({
  args: {
    orderId: v.optional(v.id("onlineOrder")),
    externalReference: v.optional(v.string()),
    registerSessionId: v.optional(v.id("registerSession")),
    update: v.record(v.string(), v.any()),
    returnItemsToStock: v.optional(v.boolean()),
    signedInAthenaUser: v.optional(
      v.object({
        id: v.id("athenaUser"),
        email: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.orderId) {
      const order = await ctx.db.get("onlineOrder", args.orderId);
      if (!order) return { success: false, message: "Order not found" };

      await applyOnlineOrderUpdate(ctx, order, args);
      return { success: true, message: "Order updated" };
    }

    if (args.externalReference) {
      const order = await findOrderByExternalReference(ctx, args.externalReference);

      if (!order) return false;

      const { refund_id, refund_amount, ...rest } = args.update;

      const refunds = [
        ...(order?.refunds ?? []),
        ...(refund_id && refund_amount
          ? [
              {
                id: refund_id,
                amount: refund_amount,
                date: Date.now(),
                signedInAthenaUser: args.signedInAthenaUser,
              },
            ]
          : []),
      ];

      if (args.update.status) {
        await applyOnlineOrderUpdate(ctx, order, {
          ...args,
          update: {
            ...rest,
            refunds,
          },
        });
      } else {
        await ctx.db.patch("onlineOrder", order._id, { ...rest, refunds });
      }

      return true;
    }
  },
});

export const reserveRefundInternal = internalMutation({
  args: {
    externalTransactionId: v.string(),
    requestedAmount: v.optional(v.number()),
  },
  returns: v.object({
    customerProfileId: v.optional(v.id("customerProfile")),
    message: v.optional(v.string()),
    orderId: v.optional(v.id("onlineOrder")),
    refundAmount: v.optional(v.number()),
    reservationId: v.optional(v.string()),
    storeId: v.optional(v.id("store")),
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const order = await findOrderByExternalTransactionId(
      ctx,
      args.externalTransactionId,
    );

    if (!order) {
      return {
        success: false,
        message: "Order not found.",
      };
    }

    try {
      const refundAmount = resolveRefundAmount({
        requestedAmount: args.requestedAmount,
        remainingRefundableBalance: getRemainingRefundableBalance(order),
      });

      if (refundAmount <= 0) {
        return {
          success: false,
          message: "This order has no remaining refundable balance.",
        };
      }

      const reservationId = `refund-reservation-${crypto.randomUUID()}`;
      await ctx.db.patch("onlineOrder", order._id, {
        refunds: [
          ...(order.refunds ?? []),
          {
            amount: refundAmount,
            date: Date.now(),
            id: reservationId,
          },
        ],
      });
      await recordOnlineOrderReturnExchangeTraceBestEffort(ctx, {
        amount: refundAmount,
        operationRef: reservationId,
        order,
        reservationId,
        stage: "refundReserved",
      });

      return {
        customerProfileId: order.customerProfileId,
        orderId: order._id,
        refundAmount,
        reservationId,
        storeId: order.storeId,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return {
        success: false,
        message:
          message ||
          "Unable to reserve the requested refund amount for this order.",
      };
    }
  },
});

export const finalizeRefundInternal = internalMutation({
  args: {
    didRefundDeliveryFee: v.optional(v.boolean()),
    externalTransactionId: v.string(),
    onlineOrderItemIds: v.optional(v.array(v.id("onlineOrderItem"))),
    refundAmount: v.number(),
    refundId: v.string(),
    reservationId: v.string(),
    signedInAthenaUser: v.optional(
      v.object({
        id: v.id("athenaUser"),
        email: v.string(),
      }),
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const order = await findOrderByExternalTransactionId(
      ctx,
      args.externalTransactionId,
    );

    if (!order) {
      return false;
    }

    const refunds = (order.refunds ?? []).map((refund) =>
      refund.id === args.reservationId
        ? {
            amount: args.refundAmount,
            date: Date.now(),
            id: args.refundId,
          }
        : refund,
    );

    await applyOnlineOrderUpdate(ctx, order, {
      signedInAthenaUser: args.signedInAthenaUser,
      update: {
        didRefundDeliveryFee: args.didRefundDeliveryFee,
        refunds,
        status: "refund-submitted",
      },
    });
    const store = await ctx.db.get("store", order.storeId);
    const selectedItems = args.onlineOrderItemIds
      ? await Promise.all(
          args.onlineOrderItemIds.map((itemId) =>
            ctx.db.get("onlineOrderItem", itemId),
          ),
        )
      : [];
    if (
      selectedItems.some(
        (item) => !item || item.orderId !== order._id,
      )
    ) {
      throw new Error("Refund item could not be found for this order.");
    }
    const selectedRefundItems = selectedItems.filter(
      (item): item is Doc<"onlineOrderItem"> => Boolean(item),
    );
    const paymentAllocation = await recordPaymentAllocationWithCtx(ctx, {
      actorUserId: args.signedInAthenaUser?.id,
      allocationType: "refund",
      amount: args.refundAmount,
      businessEventKey: `storefront:${order._id}:refund:${args.reservationId}`,
      customerProfileId: order.customerProfileId,
      direction: "out",
      evidenceProductSkuIds: [
        ...new Set(selectedRefundItems.map((item) => item.productSkuId)),
      ],
      externalReference: args.refundId,
      method: getOnlineOrderPaymentMethodLabel(order),
      onlineOrderId: order._id,
      organizationId: store?.organizationId,
      storeId: order.storeId,
      targetId: order._id,
      targetType: "online_order",
    });
    if (store?.organizationId) {
      const refundLines = buildStorefrontRefundLines({
        deliveryFee: args.didRefundDeliveryFee
          ? Math.max(0, Math.round(order.deliveryFee ?? 0))
          : 0,
        items: selectedRefundItems,
        refundAmount: args.refundAmount,
      });
      const reportingNow = Date.now();
      await appendReportingIngressWithCtx(ctx, {
        acceptedAt: reportingNow,
        adapterVersion: 1,
        businessEventKey: canonicalReportingBusinessEventKey({
          kind: "storefront_refund",
          orderId: String(order._id),
          refundId: args.refundId,
        }),
        contentFingerprint: [
          "storefront-refund-v1",
          String(order._id),
          args.reservationId,
          args.refundId,
          String(args.refundAmount),
          args.didRefundDeliveryFee ? "delivery" : "no-delivery",
          ...(args.onlineOrderItemIds ?? []).map(String).sort(),
        ].join(":"),
        grossAmountMinor: args.refundAmount,
        linkedBusinessEventKey: canonicalReportingBusinessEventKey({
          kind: "storefront_fulfillment",
          orderId: String(order._id),
        }),
        lines: refundLines,
        materialFields: ["amountMinor", "occurrenceAt", "storeId"],
        netAmountMinor: args.refundAmount,
        occurredAt: reportingNow,
        organizationId: store.organizationId,
        quantity: 0,
        settlementAmountMinor: args.refundAmount,
        sourceDomain: "storefront",
        sourceEventType: "storefront_refund_finalized",
        sourceReferences: [
          {
            relation: "reverses",
            sourceId: String(order._id),
            sourceType: "online_order",
          },
          ...(paymentAllocation?._id
            ? [
                {
                  relation: "supports" as const,
                  sourceId: String(paymentAllocation._id),
                  sourceType: "payment_allocation",
                },
              ]
            : []),
        ],
        storeId: order.storeId,
        ...storefrontCurrency(store.currency),
      });
    }
    await recordOnlineOrderReturnExchangeTraceBestEffort(ctx, {
      amount: args.refundAmount,
      operationRef: args.reservationId,
      order,
      refundId: args.refundId,
      reservationId: args.reservationId,
      signedInAthenaUser: args.signedInAthenaUser,
      stage: "refundFinalized",
    });

    return true;
  },
});

export const releaseRefundReservationInternal = internalMutation({
  args: {
    externalTransactionId: v.string(),
    reservationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const order = await findOrderByExternalTransactionId(
      ctx,
      args.externalTransactionId,
    );

    if (!order) {
      return false;
    }

    await ctx.db.patch("onlineOrder", order._id, {
      refunds: (order.refunds ?? []).filter(
        (refund) => refund.id !== args.reservationId,
      ),
    });
    await recordOnlineOrderReturnExchangeTraceBestEffort(ctx, {
      operationRef: args.reservationId,
      order,
      reservationId: args.reservationId,
      stage: "refundReleased",
    });

    return true;
  },
});

export const getReturnExchangeOverview = query({
  args: {
    orderId: v.id("onlineOrder"),
  },
  returns: v.object({
    balanceCollectedTotal: v.number(),
    pendingApprovalCount: v.number(),
    recentEvents: v.array(
      v.object({
        _id: v.id("operationalEvent"),
        createdAt: v.number(),
        eventType: v.string(),
        message: v.string(),
        workflowTraceId: v.optional(v.string()),
      }),
    ),
    refundTotal: v.number(),
  }),
  handler: async (ctx, args) => {
    const order = await ctx.db.get("onlineOrder", args.orderId);

    if (!order) {
      return {
        balanceCollectedTotal: 0,
        pendingApprovalCount: 0,
        recentEvents: [],
        refundTotal: 0,
      };
    }

    const [paymentAllocations, operationalEvents, pendingApprovals] =
      await Promise.all([
        ctx.db
          .query("paymentAllocation")
          .withIndex("by_storeId_target", (q) =>
            q
              .eq("storeId", order.storeId)
              .eq("targetType", "online_order")
              .eq("targetId", order._id),
          )
          .collect(),
        ctx.db
          .query("operationalEvent")
          .withIndex("by_storeId_subject", (q) =>
            q
              .eq("storeId", order.storeId)
              .eq("subjectType", "online_order")
              .eq("subjectId", order._id),
          )
          .collect(),
        ctx.db
          .query("approvalRequest")
          .withIndex("by_storeId_status", (q) =>
            q.eq("storeId", order.storeId).eq("status", "pending"),
          )
          .take(MAX_PENDING_APPROVALS),
      ]);

    const relevantEvents = await Promise.all(
      operationalEvents
        .filter(
          (event) =>
            event.eventType.includes("return") || event.eventType.includes("exchange"),
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_OPERATIONAL_EVENTS)
        .map(async (event) => ({
          _id: event._id,
          createdAt: event.createdAt,
          eventType: event.eventType,
          message: event.message,
          workflowTraceId: await getWorkflowTraceIdForLookup(ctx, {
            storeId: order.storeId,
            workflowType: ORDER_RETURN_EXCHANGE_WORKFLOW_TYPE,
            lookupType: ORDER_RETURN_EXCHANGE_LOOKUP_TYPES.subflowRef,
            lookupValue: `${order._id}:${event._id}`,
          }),
        })),
    );

    return {
      balanceCollectedTotal: paymentAllocations
        .filter(
          (allocation) =>
            allocation.allocationType === "online_order_exchange_balance_collection" &&
            allocation.direction === "in",
        )
        .reduce((sum, allocation) => sum + allocation.amount, 0),
      pendingApprovalCount: pendingApprovals.filter(
        (request) =>
          request.subjectType === "online_order" && request.subjectId === order._id,
      ).length,
      recentEvents: relevantEvents,
      refundTotal: paymentAllocations
        .filter(
          (allocation) =>
            allocation.allocationType === "online_order_return_refund" &&
            allocation.direction === "out",
        )
        .reduce((sum, allocation) => sum + allocation.amount, 0),
    };
  },
});

export const processReturnExchange = mutation({
  args: {
    notes: v.optional(v.string()),
    operationType: v.union(v.literal("exchange"), v.literal("return")),
    orderId: v.id("onlineOrder"),
    replacementItems: v.optional(
      v.array(
        v.object({
          productId: v.optional(v.id("product")),
          productName: v.optional(v.string()),
          productSkuId: v.id("productSku"),
          quantity: v.number(),
          unitPrice: v.number(),
        }),
      ),
    ),
    returnDisposition: v.optional(
      v.union(
        v.literal("non_restocked"),
        v.literal("damaged"),
        v.literal("missing"),
        v.literal("financial_only"),
      ),
    ),
    restockReturnedItems: v.boolean(),
    returnItemIds: v.array(v.id("onlineOrderItem")),
    signedInAthenaUser: v.optional(
      v.object({
        id: v.id("athenaUser"),
        email: v.string(),
      }),
    ),
  },
  returns: commandResultValidator(
    v.object({
      approvalRequestId: v.optional(v.id("approvalRequest")),
      balanceDueAmount: v.number(),
      message: v.string(),
      refundAmount: v.number(),
      requiresApproval: v.boolean(),
      success: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      await requireSharedDemoCapabilityIfApplicable(ctx, "payments.refund");
      const order = await ctx.db.get("onlineOrder", args.orderId);

      if (!order) {
        return userError({
          code: "not_found",
          message: "Order not found.",
        });
      }

      const store = await ctx.db.get("store", order.storeId);
      const orderItems = await listOrderItems(ctx, order._id);
      const replacementItems = await Promise.all(
        (args.replacementItems ?? []).map(async (replacement) => {
          const productSku = await ctx.db.get(
            "productSku",
            replacement.productSkuId
          );

          if (!productSku) {
            throw new Error("Replacement SKU not found.");
          }

          const product =
            (replacement.productId
              ? await ctx.db.get("product", replacement.productId)
              : null) ?? (await ctx.db.get("product", productSku.productId));

          return {
            inventoryCount: productSku.inventoryCount,
            productId: replacement.productId ?? productSku.productId,
            productName: replacement.productName ?? product?.name,
            productSkuId: replacement.productSkuId,
            quantity: replacement.quantity,
            quantityAvailable: productSku.quantityAvailable,
            skuLabel: productSku.sku,
            unitPrice: Math.round(productSku.price),
          };
        }),
      );

      if (
        args.operationType === "exchange" &&
        replacementItems.length === 0
      ) {
        return userError({
          code: "validation_failed",
          message: "Exchange flows require a replacement item.",
        });
      }

      const returnDisposition = args.restockReturnedItems
        ? ("sellable" as const)
        : (args.returnDisposition ?? "non_restocked");
      const plan = buildOnlineOrderReturnExchangePlan({
        order,
        orderItems,
        replacementItems,
        returnDisposition,
        restockReturnedItems: args.restockReturnedItems,
        returnItemIds: args.returnItemIds,
      });

      if (plan.requiresApproval) {
        const approvalRequestId = await ctx.db.insert(
          "approvalRequest",
          buildApprovalRequest({
            metadata: {
              operationType: args.operationType,
              replacementItems: replacementItems.map((item) => ({
                productName: item.productName ?? item.skuLabel ?? null,
                productSkuId: item.productSkuId,
                quantity: item.quantity,
              })),
              returnItemIds: args.returnItemIds,
            },
            notes: args.notes,
            organizationId: store?.organizationId,
            reason: plan.approvalReason ?? undefined,
            requestType: "online_order_return_review",
            requestedByUserId: args.signedInAthenaUser?.id,
            storeId: order.storeId,
            subjectId: order._id,
            subjectType: "online_order",
          }),
        );

        const approvalEvent = await recordOperationalEventWithCtx(ctx, {
          actorUserId: args.signedInAthenaUser?.id,
          approvalRequestId,
          customerProfileId: order.customerProfileId,
          eventType: plan.eventType,
          message: plan.eventMessage,
          metadata: {
            operationType: args.operationType,
            returnItemIds: args.returnItemIds,
          },
          onlineOrderId: order._id,
          organizationId: store?.organizationId,
          reason: plan.approvalReason ?? undefined,
          storeId: order.storeId,
          subjectId: order._id,
          subjectLabel: order.orderNumber,
          subjectType: "online_order",
        });
        await recordOnlineOrderReturnExchangeTraceBestEffort(ctx, {
          approvalRequestId,
          eventRef: String(approvalEvent?._id ?? approvalRequestId),
          itemCount: args.returnItemIds.length,
          operationRef: String(approvalRequestId),
          order,
          organizationId: store?.organizationId,
          replacementCount: replacementItems.length,
          signedInAthenaUser: args.signedInAthenaUser,
          stage: "approvalRequired",
        });

        return ok({
          approvalRequestId,
          balanceDueAmount: plan.balanceDueAmount,
          message: "Return or exchange sent for approval.",
          refundAmount: plan.refundAmount,
          requiresApproval: true,
          success: true,
        });
      }

      const now = Date.now();
      const returnExchangeRefundId = `return-exchange-${now}`;

      await Promise.all(
        plan.selectedItems.map(async (item) => {
          const nextFields = {
            isRefunded: true,
            returnDisposition,
            ...(args.restockReturnedItems ? { isRestocked: true } : {}),
          };

          await ctx.db.patch("onlineOrderItem", item._id, nextFields);
        }),
      );

      const reportedReturns = buildOnlineOrderReportedReturns({
        disposition: returnDisposition,
        selectedItems: plan.selectedItems,
      });
      const returnMovementIds = await Promise.all(
        reportedReturns.map(async (movement) => {
          const productSku = await ctx.db.get(
            "productSku",
            movement.productSkuId
          );

          if (!productSku) {
            throw new Error("Returned item SKU not found.");
          }

          if (!store?.organizationId) {
            throw new Error("Online order organization could not be resolved.");
          }
          const originalEffect = movement.orderItemId
            ? await ctx.db
                .query("reportingInventoryEffect")
                .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
                  q
                    .eq("storeId", order.storeId)
                    .eq("sourceDomain", "storefront")
                    .eq(
                      "businessEventKey",
                      `storefront:${order._id}:line:${movement.orderItemId}:fulfillment`,
                    ),
                )
                .first()
            : null;
          const inventoryEffect = await applyCommerceInventoryEffectWithCtx(ctx, {
            activityType: "stock_restock",
            actorUserId: args.signedInAthenaUser?.id,
            businessEventKey: `storefront:${order._id}:return_exchange:${returnExchangeRefundId}:return:${movement.orderItemId}`,
            completeness: "partial",
            contentFingerprint: `storefront-return-exchange-restock-v1:${order._id}:${returnExchangeRefundId}:${movement.orderItemId}:${movement.quantity}`,
            customerProfileId: order.customerProfileId,
            disposition: returnDisposition,
            effectType: "return",
            financialContribution:
              returnDisposition === "sellable"
                ? "reverse_original_lane"
                : "none",
            kind: "return",
            movementType: "restock",
            notes: args.notes ?? order.orderNumber,
            onlineOrderId: order._id,
            occurrenceAt: now,
            organizationId: store.organizationId,
            originalBasis:
              originalEffect
                ? outboundBasisFromEffect(originalEffect, movement.quantity) ??
                  undefined
                : undefined,
            productId: movement.productId,
            productSkuId: movement.productSkuId,
            quantity: movement.quantity,
            reasonCode: movement.reasonCode,
            sourceId: buildReturnExchangeReturnSourceId(
              order._id,
              movement.orderItemId!
            ),
            sourceType: "online_order_return",
            sellableQuantityDelta:
              returnDisposition === "sellable" ? movement.quantity : 0,
            sourceDomain: "storefront",
            sourceLineId: String(movement.orderItemId),
            storeId: order.storeId,
          });

          return inventoryEffect.movement?._id ?? null;
        }),
      );

      const exchangeMovementIds = await Promise.all(
        plan.exchangeMovements.map(async (movement, index) => {
          const productSku = await ctx.db.get(
            "productSku",
            movement.productSkuId
          );

          if (!productSku) {
            throw new Error("Replacement SKU not found.");
          }

          if (!store?.organizationId) {
            throw new Error("Online order organization could not be resolved.");
          }
          const inventoryEffect = await applyCommerceInventoryEffectWithCtx(ctx, {
            activityType: "stock_exchange",
            actorUserId: args.signedInAthenaUser?.id,
            businessEventKey: `storefront:${order._id}:return_exchange:${returnExchangeRefundId}:replacement:${index}`,
            completeness: "partial",
            contentFingerprint: `storefront-return-exchange-issue-v1:${order._id}:${returnExchangeRefundId}:${movement.productSkuId}:${index}:${movement.quantity}`,
            customerProfileId: order.customerProfileId,
            disposition: "exchange_replacement",
            effectType: "sale",
            kind: "outbound",
            movementType: "exchange",
            notes: args.notes ?? order.orderNumber,
            onlineOrderId: order._id,
            occurrenceAt: now,
            organizationId: store.organizationId,
            productId: movement.productId,
            productSkuId: movement.productSkuId,
            quantity: movement.quantity,
            reasonCode: movement.reasonCode,
            sourceId: buildReturnExchangeReplacementSourceId(
              order._id,
              movement.productSkuId,
              index
            ),
            sourceType: "online_order_exchange",
            sellableQuantityDelta: -movement.quantity,
            sourceDomain: "storefront",
            sourceLineId: String(index),
            storeId: order.storeId,
          });

          return inventoryEffect.movement?._id ?? null;
        }),
      );

      const paymentAllocation = plan.paymentAllocation
        ? await recordPaymentAllocationWithCtx(ctx, {
          actorUserId: args.signedInAthenaUser?.id,
          allocationType: plan.paymentAllocation.allocationType,
          amount: plan.paymentAllocation.amount,
          businessEventKey: `storefront:${order._id}:return_exchange:${returnExchangeRefundId}:settlement`,
          collectedInStore: plan.paymentAllocation.direction === "in",
          customerProfileId: order.customerProfileId,
          direction: plan.paymentAllocation.direction,
          evidenceProductSkuIds:
            plan.paymentAllocation.direction === "out"
              ? [
                  ...new Set(
                    plan.selectedItems.map((item) => item.productSkuId),
                  ),
                ]
              : undefined,
          method: getOnlineOrderPaymentMethodLabel(order),
          notes: args.notes ?? order.orderNumber,
          onlineOrderId: order._id,
          organizationId: store?.organizationId,
          storeId: order.storeId,
          targetId: order._id,
          targetType: "online_order",
        })
        : null;

      const nextRefunds =
        plan.refundAmount > 0
          ? [
              ...(order.refunds ?? []),
              {
                amount: plan.refundAmount,
                date: now,
                id: returnExchangeRefundId,
              },
            ]
          : order.refunds;

      await ctx.db.patch("onlineOrder", order._id, {
        refunds: nextRefunds,
        updatedAt: now,
      });

      const inventoryMovementIds = [
        ...returnMovementIds,
        ...exchangeMovementIds,
      ].filter((value): value is Id<"inventoryMovement"> => Boolean(value));

      await markCatalogSummaryNeedsRefresh(ctx, order.storeId);

      const operationalEvent = await recordOperationalEventWithCtx(ctx, {
        actorUserId: args.signedInAthenaUser?.id,
        customerProfileId: order.customerProfileId,
        eventType: plan.eventType,
        inventoryMovementId: inventoryMovementIds[0] ?? undefined,
        message: plan.eventMessage,
        metadata: {
          balanceDueAmount: plan.balanceDueAmount,
          operationType: args.operationType,
          replacementItems: replacementItems.map((item) => ({
            productName: item.productName ?? item.skuLabel ?? null,
            productSkuId: item.productSkuId,
            quantity: item.quantity,
          })),
          refundAmount: plan.refundAmount,
          returnDisposition,
          returnItemIds: args.returnItemIds,
        },
        onlineOrderId: order._id,
        organizationId: store?.organizationId,
        paymentAllocationId: paymentAllocation?._id,
        reason: plan.kind,
        storeId: order.storeId,
        subjectId: order._id,
        subjectLabel: order.orderNumber,
        subjectType: "online_order",
      });
      if (plan.refundAmount > 0 && store?.organizationId) {
        const refundLines = buildStorefrontRefundLines({
          deliveryFee: 0,
          items: plan.selectedItems,
          refundAmount: plan.refundAmount,
        });
        await appendReportingIngressWithCtx(ctx, {
          acceptedAt: now,
          adapterVersion: 1,
          businessEventKey: canonicalReportingBusinessEventKey({
            kind: "storefront_refund",
            orderId: String(order._id),
            refundId: returnExchangeRefundId,
          }),
          contentFingerprint: [
            "storefront-return-exchange-refund-v1",
            String(order._id),
            returnExchangeRefundId,
            String(plan.refundAmount),
            ...plan.selectedItems.map((item) => String(item._id)).sort(),
          ].join(":"),
          grossAmountMinor: plan.refundAmount,
          linkedBusinessEventKey: canonicalReportingBusinessEventKey({
            kind: "storefront_fulfillment",
            orderId: String(order._id),
          }),
          lines: refundLines,
          materialFields: ["amountMinor", "occurrenceAt", "storeId"],
          netAmountMinor: plan.refundAmount,
          occurredAt: now,
          organizationId: store.organizationId,
          quantity: 0,
          settlementAmountMinor: plan.refundAmount,
          sourceDomain: "storefront",
          sourceEventType: "storefront_return_exchange_refund",
          sourceReferences: [
            {
              relation: "reverses",
              sourceId: String(order._id),
              sourceType: "online_order",
            },
            ...(operationalEvent?._id
              ? [
                  {
                    relation: "supports" as const,
                    sourceId: String(operationalEvent._id),
                    sourceType: "operational_event",
                  },
                ]
              : []),
            ...(paymentAllocation?._id
              ? [
                  {
                    relation: "supports" as const,
                    sourceId: String(paymentAllocation._id),
                    sourceType: "payment_allocation",
                  },
                ]
              : []),
          ],
          storeId: order.storeId,
          ...storefrontCurrency(store.currency),
        });
      }
      const operationRef = String(operationalEvent?._id ?? `${order._id}:${now}`);

      if (plan.returnMovements.length > 0) {
        await recordOnlineOrderReturnExchangeTraceBestEffort(ctx, {
          eventRef: `${operationRef}:restock`,
          inventoryMovementIds,
          itemCount: plan.returnMovements.length,
          operationRef,
          order,
          organizationId: store?.organizationId,
          signedInAthenaUser: args.signedInAthenaUser,
          stage: "restocked",
        });
      }

      if (plan.exchangeMovements.length > 0) {
        await recordOnlineOrderReturnExchangeTraceBestEffort(ctx, {
          eventRef: `${operationRef}:replacement`,
          inventoryMovementIds,
          itemCount: plan.exchangeMovements.length,
          operationRef,
          order,
          organizationId: store?.organizationId,
          replacementCount: plan.replacementItems.length,
          signedInAthenaUser: args.signedInAthenaUser,
          stage: "replacementIssued",
        });
      }

      if (plan.balanceDueAmount > 0 && paymentAllocation?._id) {
        await recordOnlineOrderReturnExchangeTraceBestEffort(ctx, {
          amount: plan.balanceDueAmount,
          operationRef,
          order,
          organizationId: store?.organizationId,
          paymentAllocationId: paymentAllocation._id,
          signedInAthenaUser: args.signedInAthenaUser,
          stage: "balanceCollected",
        });
      }

      if (plan.refundAmount > 0) {
        await recordOnlineOrderReturnExchangeTraceBestEffort(ctx, {
          amount: plan.refundAmount,
          operationRef,
          order,
          organizationId: store?.organizationId,
          paymentAllocationId: paymentAllocation?._id,
          refundId: returnExchangeRefundId,
          signedInAthenaUser: args.signedInAthenaUser,
          stage: "refundFinalized",
        });
      }

      await recordOnlineOrderReturnExchangeTraceBestEffort(ctx, {
        amount: plan.refundAmount || plan.balanceDueAmount || undefined,
        eventRef: operationRef,
        itemCount: plan.selectedItems.length,
        operationRef,
        order,
        organizationId: store?.organizationId,
        replacementCount: plan.replacementItems.length,
        signedInAthenaUser: args.signedInAthenaUser,
        stage: plan.kind === "exchange" ? "exchangeProcessed" : "returnProcessed",
      });

      return ok({
        balanceDueAmount: plan.balanceDueAmount,
        message:
          args.operationType === "exchange"
            ? "Exchange recorded."
            : "Return recorded.",
        refundAmount: plan.refundAmount,
        requiresApproval: false,
        success: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      if (
        message === "Order not found." ||
        message === "Replacement SKU not found." ||
        message === "Returned item SKU not found."
      ) {
        return userError({
          code: "not_found",
          message,
        });
      }

      if (message === "Exchange flows require a replacement item.") {
        return userError({
          code: "validation_failed",
          message,
        });
      }

      throw error;
    }
  },
});

async function returnSelectedOnlineOrderItemsToStock(
  ctx: MutationCtx,
  args: {
    itemIds: Id<"onlineOrderItem">[];
    order: Doc<"onlineOrder">;
  },
) {
  const store = await ctx.db.get("store", args.order.storeId);
  if (!store?.organizationId) {
    throw new Error("Online order organization could not be resolved.");
  }
  const occurredAt = Date.now();
  await Promise.all(
    args.itemIds.map(async (itemId) => {
      const item = await ctx.db.get("onlineOrderItem", itemId);
      if (!item || item.orderId !== args.order._id || item.isRestocked) return;

      await ctx.db.patch("onlineOrderItem", itemId, {
        isRefunded: true,
        isRestocked: true,
      });
      const sku = await ctx.db.get("productSku", item.productSkuId);
      if (!sku) return;
      const originalEffect = item.isReady
        ? await ctx.db
            .query("reportingInventoryEffect")
            .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
              q
                .eq("storeId", args.order.storeId)
                .eq("sourceDomain", "storefront")
                .eq(
                  "businessEventKey",
                  `storefront:${args.order._id}:line:${item._id}:fulfillment`,
                ),
            )
            .first()
        : null;
      await applyCommerceInventoryEffectWithCtx(ctx, {
        activityType: item.isReady
          ? "stock_restock"
          : "reservation_released",
        businessEventKey: `storefront:${args.order._id}:line:${item._id}:refund_return`,
        completeness: "partial",
        contentFingerprint: `storefront-refund-return-v1:${args.order._id}:${item._id}:${item.quantity}:${item.isReady === true}`,
        effectType: item.isReady ? "return" : "adjustment",
        ...(item.isReady
          ? {
              kind: "return" as const,
              originalBasis:
                originalEffect
                  ? outboundBasisFromEffect(originalEffect, item.quantity) ??
                    undefined
                  : undefined,
              quantity: item.quantity,
            }
          : { kind: "availability_only" as const }),
        movementType: item.isReady ? "restock" : "reservation_release",
        occurrenceAt: occurredAt,
        onlineOrderId: args.order._id,
        organizationId: store.organizationId,
        productId: item.productId,
        productSkuId: item.productSkuId,
        reasonCode: item.isReady
          ? "online_order_item_restocked"
          : "online_order_reservation_released",
        sellableQuantityDelta: item.quantity,
        sourceDomain: "storefront",
        sourceId: String(args.order._id),
        sourceLineId: String(item._id),
        sourceType: "online_order_item",
        storeId: args.order.storeId,
      });
    }),
  );
}

export const returnItemsToStock = mutation({
  args: {
    externalTransactionId: v.string(),
    onlineOrderItemIds: v.optional(v.array(v.id("onlineOrderItem"))),
  },
  handler: async (ctx, args) => {
    if (args.externalTransactionId) {
      const order = await findOrderByExternalTransactionId(
        ctx,
        args.externalTransactionId
      );

      if (!order) return false;

      if (args.onlineOrderItemIds?.length) {
        await returnSelectedOnlineOrderItemsToStock(ctx, {
          itemIds: args.onlineOrderItemIds,
          order,
        });

        await markCatalogSummaryNeedsRefresh(ctx, order.storeId);

        return true;
      }

      await returnOrderItemsToStock(ctx, order._id);

      return true;
    }
  },
});

export const returnItemsToStockInternal = internalMutation({
  args: {
    externalTransactionId: v.string(),
    onlineOrderItemIds: v.optional(v.array(v.id("onlineOrderItem"))),
  },
  handler: async (ctx, args) => {
    if (args.externalTransactionId) {
      const order = await findOrderByExternalTransactionId(
        ctx,
        args.externalTransactionId
      );

      if (!order) return false;

      if (args.onlineOrderItemIds?.length) {
        await returnSelectedOnlineOrderItemsToStock(ctx, {
          itemIds: args.onlineOrderItemIds,
          order,
        });

        return true;
      }

      await returnOrderItemsToStock(ctx, order._id);

      return true;
    }
  },
});

export const updateOrderItems = mutation({
  args: {
    orderItemIds: v.array(v.id("onlineOrderItem")),
    updates: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    await Promise.all(
      args.orderItemIds.map(async (itemId) => {
        await ctx.db.patch("onlineOrderItem", itemId, args.updates);
      }),
    );
    return true;
  },
});

export const updateOrderItemsInternal = internalMutation({
  args: {
    orderItemIds: v.array(v.id("onlineOrderItem")),
    updates: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    await Promise.all(
      args.orderItemIds.map(async (itemId) => {
        await ctx.db.patch("onlineOrderItem", itemId, args.updates);
      }),
    );
    return true;
  },
});

export const returnAllItemsToStock = mutation({
  args: { orderId: v.id("onlineOrder") },
  handler: async (ctx, args) => {
    await returnOrderItemsToStock(ctx, args.orderId);
    return true;
  },
});

export const returnAllItemsToStockInternal = internalMutation({
  args: { orderId: v.id("onlineOrder") },
  handler: async (ctx, args) => {
    await returnOrderItemsToStock(ctx, args.orderId);
    return true;
  },
});

export const newOrder = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    await requireSharedDemoStoreReadIfApplicable(ctx, args.storeId);
    const order = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .order("desc")
      .first();

    return order;
  },
});

export const getOrderItems = query({
  args: { orderId: v.id("onlineOrder") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("onlineOrderItem")
      .filter((q) => q.eq(q.field("orderId"), args.orderId))
      .collect();

    return items;
  },
});

export const updateOwner = mutation({
  args: {
    currentOwner: v.id("guest"),
    newOwner: v.id("storeFrontUser"),
  },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.currentOwner))
      .collect();

    console.info(
      `updating owner for orders from ${args.currentOwner} to ${args.newOwner}`,
    );

    // Update all orders
    await Promise.all(
      orders.map(async (order) => {
        await ctx.db.patch("onlineOrder", order._id, {
          storeFrontUserId: args.newOwner,
        });

        // Get and update all order items for this order
        const orderItems = await ctx.db
          .query("onlineOrderItem")
          .filter((q) => q.eq(q.field("orderId"), order._id))
          .collect();

        await Promise.all(
          orderItems.map((item) =>
            ctx.db.patch("onlineOrderItem", item._id, {
              storeFrontUserId: args.newOwner,
            }),
          ),
        );
      }),
    );

    console.info("successfully updated owner for orders");

    return true;
  },
});

export const isDuplicateOrder = query({
  args: {
    id: v.id("onlineOrder"),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get("onlineOrder", args.id);
    if (!order) {
      return false;
    }

    const orders = await ctx.db
      .query(entity)
      .filter((q) =>
        q.eq(q.field("externalReference"), order.externalReference),
      )
      .collect();

    return orders.length > 1;
  },
});

export const getOrderMetrics = query({
  args: {
    storeId: v.id("store"),
    timeRange: v.union(
      v.literal("day"),
      v.literal("week"),
      v.literal("month"),
      v.literal("all"),
    ),
  },
  returns: v.object({
    totalOrders: v.number(),
    grossSales: v.number(),
    totalDiscounts: v.number(),
    netRevenue: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireSharedDemoStoreReadIfApplicable(ctx, args.storeId);
    // Calculate time filter based on time range
    let timeFilter: number | undefined;
    const now = Date.now();

    switch (args.timeRange) {
      case "day":
        timeFilter = now - 24 * 60 * 60 * 1000; // Last 24 hours
        break;
      case "week":
        timeFilter = now - 7 * 24 * 60 * 60 * 1000; // Last 7 days
        break;
      case "month":
        timeFilter = now - 30 * 24 * 60 * 60 * 1000; // Last 30 days
        break;
      case "all":
        timeFilter = undefined; // No time filter
        break;
    }

    // Query orders filtered by store and time range
    let ordersQuery = ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId));

    // Apply time filter if specified
    if (timeFilter !== undefined) {
      ordersQuery = ordersQuery.filter((q) =>
        q.gte(q.field("_creationTime"), timeFilter!),
      );
    }

    const allOrders = await ordersQuery.collect();

    // Filter for open and completed orders only
    const allowedStatuses = [
      "picked-up",
      "delivered",
      "out-for-delivery",
      "ready-for-pickup",
      "ready-for-delivery",
      "open",
    ];

    const filteredOrders = allOrders.filter((order) =>
      allowedStatuses.includes(order.status),
    );

    // Get all order items for discount calculations
    const ordersWithItems = await Promise.all(
      filteredOrders.map(async (order) => {
        const items = await ctx.db
          .query("onlineOrderItem")
          .filter((q) => q.eq(q.field("orderId"), order._id))
          .collect();
        return { ...order, items };
      }),
    );

    // Calculate metrics
    const totalOrders = ordersWithItems.length;
    let grossSales = 0;
    let totalDiscounts = 0;
    let netRevenue = 0;

    ordersWithItems.forEach((order) => {
      // Gross sales = subtotal (order.amount is in cents/pesewas)
      const subtotal = order.amount || 0;
      grossSales += subtotal;

      // Calculate discount using the utility function for consistency
      const discountValue = getDiscountValue(order.items, order.discount);
      totalDiscounts += discountValue;

      // Net revenue = subtotal + delivery fees - discounts
      const deliveryFee = order.deliveryFee || 0; // already pesewas
      netRevenue += subtotal + deliveryFee - discountValue;
    });

    return {
      totalOrders,
      grossSales,
      totalDiscounts,
      netRevenue,
    };
  },
});

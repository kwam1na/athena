import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";
import {
  getStoreDataFromRequest,
  getStorefrontUserFromRequest,
} from "../../../utils";
import { Id } from "../../../../_generated/dataModel";
import { isStoreCheckoutDisabled } from "../../../../inventory/storeConfigV2";
import { z } from "zod";
import {
  buildCanonicalCheckoutProducts,
  hasValidPositiveQuantity,
  isAmountTampered,
  isAuthorizedResourceOwner,
} from "./security";

const checkoutRoutes: HonoWithConvex<ActionCtx> = new Hono();

const createCheckoutSchema = z
  .object({
    bagId: z.string().min(1),
  })
  .passthrough();

const checkoutActionSchema = z
  .object({
    customerEmail: z.string().email().optional(),
    amount: z.number().finite().optional(),
    hasCompletedCheckoutSession: z.boolean().optional(),
    action: z.enum([
      "finalize-payment",
      "complete-checkout",
      "place-order",
      "create-pod-order",
      "cancel-order",
      "update-order",
    ]),
    orderDetails: z.unknown().optional(),
    placedOrderId: z.string().optional(),
  })
  .passthrough();

const checkoutOrderDetailsSchema = z
  .object({
    billingDetails: z.record(z.string(), z.any()).nullable(),
    customerDetails: z
      .object({
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phoneNumber: z.string().min(1),
      })
      .optional(),
    deliveryDetails: z.union([
      z.record(z.string(), z.any()),
      z.string(),
      z.null(),
    ]),
    deliveryFee: z.number().nullable(),
    deliveryMethod: z.string().min(1),
    deliveryOption: z.string().nullable(),
    deliveryInstructions: z.string().optional(),
    pickupLocation: z.string().nullable(),
    discount: z.any().nullable().optional(),
    paymentMethod: z
      .union([z.literal("online_payment"), z.literal("payment_on_delivery")])
      .optional(),
    podPaymentMethod: z
      .union([z.literal("cash"), z.literal("mobile_money")])
      .optional(),
  })
  .passthrough();

type CanonicalBagItem = {
  productId: string;
  productSku: string;
  productSkuId: string;
  quantity: number;
  price: number;
};

const hasValidCanonicalBagItem = (item: any): item is CanonicalBagItem => {
  return (
    typeof item?.productId === "string" &&
    typeof item?.productSkuId === "string" &&
    typeof item?.productSku === "string" &&
    Number.isFinite(item?.price) &&
    item.price > 0 &&
    hasValidPositiveQuantity(item?.quantity)
  );
};

const hasValidSessionItems = (items: any[] | undefined): boolean => {
  if (!items || items.length === 0) {
    return false;
  }

  return items.every(
    (item) =>
      hasValidPositiveQuantity(item.quantity) &&
      typeof item.price === "number" &&
      Number.isFinite(item.price) &&
      item.price > 0,
  );
};

checkoutRoutes.post("/", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  const parsedPayload = createCheckoutSchema.safeParse(await c.req.json());

  if (!parsedPayload.success) {
    return c.json({ error: "Invalid checkout payload" }, 400);
  }

  try {
    const bag = await c.env.runQuery(api.storeFront.bag.getById, {
      id: parsedPayload.data.bagId as Id<"bag">,
    });

    if (!bag) {
      return c.json({ error: "Bag not found" }, 404);
    }

    if (!isAuthorizedResourceOwner(bag.storeFrontUserId, userId)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    if (bag.storeId !== storeId) {
      return c.json({ error: "Forbidden" }, 403);
    }

    if (!Array.isArray(bag.items) || bag.items.length === 0) {
      return c.json({ error: "Bag has no checkoutable items" }, 422);
    }

    if (!bag.items.every(hasValidCanonicalBagItem)) {
      return c.json(
        { error: "Invalid bag item data: quantity and price must be valid" },
        422,
      );
    }

    const canonicalCheckout = buildCanonicalCheckoutProducts(bag.items);

    const session = await c.env.runMutation(
      api.storeFront.checkoutSession.create,
      {
        storeId: storeId as Id<"store">,
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
        products: canonicalCheckout.products.map((product) => ({
          productId: product.productId as Id<"product">,
          productSkuId: product.productSkuId as Id<"productSku">,
          productSku: product.productSku,
          quantity: product.quantity,
          price: product.price,
        })),
        bagId: parsedPayload.data.bagId as Id<"bag">,
        amount: canonicalCheckout.amount,
      },
    );

    return c.json(session);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

checkoutRoutes.post("/:checkoutSessionId", async (c) => {
  const { checkoutSessionId } = c.req.param();

  const userId = getStorefrontUserFromRequest(c);
  const { storeId, organizationId } = getStoreDataFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  if (!storeId || !organizationId) {
    return c.json({ error: "Store or organization id missing" }, 404);
  }

  const parsedBody = checkoutActionSchema.safeParse(await c.req.json());

  if (!parsedBody.success) {
    return c.json({ error: "Invalid checkout action payload" }, 400);
  }

  const {
    customerEmail,
    amount,
    hasCompletedCheckoutSession,
    action,
    orderDetails,
    placedOrderId,
  } = parsedBody.data;

  const session = await c.env.runQuery(api.storeFront.checkoutSession.getById, {
    sessionId: checkoutSessionId as Id<"checkoutSession">,
  });

  if (!session) {
    return c.json({ error: "Checkout session not found" }, 404);
  }

  if (!isAuthorizedResourceOwner(session.storeFrontUserId, userId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  try {
    if (action == "finalize-payment") {
      if (!hasValidSessionItems(session.items)) {
        return c.json(
          {
            error:
              "Invalid checkout session item data: quantity must be positive",
          },
          422,
        );
      }

      const parsedOrderDetails =
        checkoutOrderDetailsSchema.safeParse(orderDetails);

      if (!parsedOrderDetails.success) {
        return c.json({ error: "Invalid order details payload" }, 400);
      }

      if (
        parsedOrderDetails.data.deliveryFee !== null &&
        parsedOrderDetails.data.deliveryFee < 0
      ) {
        return c.json({ error: "Delivery fee must be zero or positive" }, 422);
      }

      if (isAmountTampered(session.amount, amount)) {
        return c.json({ error: "Amount mismatch detected" }, 422);
      }

      const store = await c.env.runQuery(internal.inventory.stores.getByIdOrSlug, {
        identifier: storeId,
        organizationId: organizationId as Id<"organization">,
      });

      const { config } = store || {};

      if (isStoreCheckoutDisabled(config)) {
        return c.json({
          success: false,
          message: "Store checkout is currently not available",
        });
      }

      if (session?.hasCompletedPayment || session.placedOrderId) {
        return c.json({
          success: false,
          message:
            "This checkout session has already been completed. Please refresh the page or return to your shopping bag to start a new checkout.",
          code: "SESSION_ALREADY_FINALIZED",
        });
      }

      const payment = await c.env.runAction(
        api.storeFront.payment.createTransaction,
        {
          customerEmail: customerEmail || "",
          amount: session.amount,
          checkoutSessionId: checkoutSessionId as Id<"checkoutSession">,
          orderDetails: {
            ...parsedOrderDetails.data,
            billingDetails: null,
            deliveryDetails: (parsedOrderDetails.data.deliveryDetails ??
              null) as any,
            discount: session.discount ?? null,
          },
        },
      );

      return c.json(payment);
    }

    if (action == "complete-checkout") {
      let orderDetailsToUse = orderDetails;

      try {
        if (!orderDetails) {
          const order = await c.env.runQuery(
            api.storeFront.onlineOrder.getByCheckoutSessionId,
            {
              checkoutSessionId: checkoutSessionId as Id<"checkoutSession">,
            },
          );

          if (order) {
            orderDetailsToUse = {
              billingDetails: order.billingDetails || null,
              customerDetails: order.customerDetails,
              deliveryDetails: order.deliveryDetails,
              deliveryInstructions: order.deliveryInstructions || undefined,
              deliveryFee: order.deliveryFee,
              deliveryMethod: order.deliveryMethod,
              deliveryOption: order.deliveryOption,
              discount: order.discount,
              pickupLocation: order.pickupLocation,
            };
          }
        }

        const parsedOrderDetails =
          checkoutOrderDetailsSchema.safeParse(orderDetailsToUse);

        if (!parsedOrderDetails.success) {
          return c.json({ error: "Invalid order details payload" }, 400);
        }

        const res = await c.env.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          {
            id: checkoutSessionId as Id<"checkoutSession">,
            hasCompletedCheckoutSession: true,
            orderDetails: {
              ...parsedOrderDetails.data,
              billingDetails: null,
              deliveryDetails: (parsedOrderDetails.data.deliveryDetails ??
                null) as any,
              discount: session.discount ?? null,
            },
          },
        );

        return c.json(res);
      } catch (e) {
        console.error("error completing checkout session in api route", e);
        return c.json({ success: false, message: (e as Error).message }, 400);
      }
    }

    if (action == "place-order") {
      const res = await c.env.runMutation(
        internal.storeFront.checkoutSession.updateCheckoutSession,
        {
          id: checkoutSessionId as Id<"checkoutSession">,
          hasCompletedCheckoutSession,
          action,
        },
      );

      return c.json(res);
    }

    if (action == "create-pod-order") {
      if (!hasValidSessionItems(session.items)) {
        return c.json(
          {
            error:
              "Invalid checkout session item data: quantity must be positive",
          },
          422,
        );
      }

      const parsedOrderDetails =
        checkoutOrderDetailsSchema.safeParse(orderDetails);

      if (!parsedOrderDetails.success) {
        return c.json({ error: "Invalid order details payload" }, 400);
      }

      if (
        parsedOrderDetails.data.deliveryFee !== null &&
        parsedOrderDetails.data.deliveryFee < 0
      ) {
        return c.json({ error: "Delivery fee must be zero or positive" }, 422);
      }

      if (isAmountTampered(session.amount, amount)) {
        return c.json({ error: "Amount mismatch detected" }, 422);
      }

      const store = await c.env.runQuery(internal.inventory.stores.getByIdOrSlug, {
        identifier: storeId,
        organizationId: organizationId as Id<"organization">,
      });

      const { config } = store || {};

      if (isStoreCheckoutDisabled(config)) {
        return c.json({
          success: false,
          message: "Store checkout is currently not available",
        });
      }

      if (session?.hasCompletedPayment || session.placedOrderId) {
        return c.json(
          {
            success: false,
            message: "This checkout session has already been completed.",
            code: "SESSION_ALREADY_FINALIZED",
          },
          422,
        );
      }

      const podOrder = await c.env.runAction(
        api.storeFront.payment.createPODOrder,
        {
          customerEmail: customerEmail || "",
          amount: session.amount,
          checkoutSessionId: checkoutSessionId as Id<"checkoutSession">,
          orderDetails: {
            ...parsedOrderDetails.data,
            billingDetails: null,
            deliveryDetails: (parsedOrderDetails.data.deliveryDetails ??
              null) as any,
            discount: session.discount ?? null,
          },
        },
      );

      return c.json(podOrder);
    }

    if (action == "cancel-order") {
      const res = await c.env.runAction(
        api.storeFront.checkoutSession.cancelOrder,
        {
          id: checkoutSessionId as Id<"checkoutSession">,
        },
      );

      return c.json(res);
    }

    if (action == "update-order") {
      const res = await c.env.runMutation(
        internal.storeFront.checkoutSession.updateCheckoutSession,
        {
          id: checkoutSessionId as Id<"checkoutSession">,
          placedOrderId,
          hasCompletedCheckoutSession,
        },
      );

      return c.json(res);
    }

    return c.json({ error: "Unsupported checkout action" }, 400);
  } catch (e) {
    console.log(
      `[CHECKOUT-FAILURE] Error in checkout endpoint | Session: ${checkoutSessionId} | Action: ${action} | Error: ${(e as Error).message}`,
    );
    return c.json({ error: (e as Error).message }, 400);
  }
});

checkoutRoutes.get("/active", async (c) => {
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  try {
    const session = await c.env.runQuery(
      api.storeFront.checkoutSession.getActiveCheckoutSession,
      {
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
      },
    );

    return c.json(session);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

checkoutRoutes.get("/pending", async (c) => {
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  const session = await c.env.runQuery(
    api.storeFront.checkoutSession.getPendingCheckoutSessions,
    {
      storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    },
  );

  return c.json(session);
});

checkoutRoutes.get("/:sessionId", async (c) => {
  const { sessionId } = c.req.param();
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  const session = await c.env.runQuery(api.storeFront.checkoutSession.getById, {
    sessionId: sessionId as Id<"checkoutSession">,
  });

  if (!session) {
    return c.json({ error: "Checkout session not found" }, 404);
  }

  if (!isAuthorizedResourceOwner(session.storeFrontUserId, userId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json(session);
});

checkoutRoutes.get("/verify/:reference", async (c) => {
  const { reference } = c.req.param();

  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  const res = await c.env.runAction(api.storeFront.payment.verifyPayment, {
    storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    externalReference: reference,
  });

  return c.json(res);
});

export { checkoutRoutes };

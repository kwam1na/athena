import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { SignJWT } from "jose";
import { STOREFRONT_ACTOR_SIGNING_KEY } from "../../../../env";
import { enforceActorStoreAccess, getActorClaims } from "./actorAuth";

const encoder = new TextEncoder();

const e2eRoutes: HonoWithConvex<ActionCtx> = new Hono();

e2eRoutes.post("/checkout/bootstrap", async (c) => {
  const authError = await enforceActorStoreAccess(c);
  if (authError) {
    return authError;
  }

  const organizationId = c.req.param("organizationId");
  const storeId = c.req.param("storeId");

  if (!organizationId || !storeId) {
    return c.json({ error: "Invalid route context." }, 400);
  }

  const body = await c.req.json();
  const { marker, items } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: "At least one item is required." }, 400);
  }

  // Get or create guest
  let guest = await c.env.runQuery(api.storeFront.guest.getByMarker, {
    marker,
  });

  if (!guest) {
    guest = await c.env.runMutation(api.storeFront.guest.create, {
      marker,
      creationOrigin: "storefront",
      storeId: storeId as Id<"store">,
      organizationId: organizationId as Id<"organization">,
    });
  }

  if (!guest) {
    return c.json({ error: "Unable to create guest actor." }, 500);
  }

  const guestId = guest._id as Id<"guest">;

  // Get or create bag
  let bag = await c.env.runQuery(api.storeFront.bag.getByUserId, {
    storeFrontUserId: guestId,
  });

  if (!bag) {
    bag = await c.env.runMutation(api.storeFront.bag.create, {
      storeFrontUserId: guestId,
      storeId: storeId as Id<"store">,
    }) as any;
  }

  if (!bag) {
    return c.json({ error: "Unable to create bag." }, 500);
  }

  const bagId = bag._id as Id<"bag">;

  // Clear bag for a clean E2E state
  await c.env.runMutation(api.storeFront.bag.clearBag, { id: bagId });

  // Process each item
  type ProductEntry = {
    price: number;
    productId: Id<"product">;
    productSku: string;
    productSkuId: Id<"productSku">;
    quantity: number;
  };

  const products: ProductEntry[] = [];
  let totalAmount = 0;

  for (const item of items) {
    const { productSlug, quantity, sku: skuHint } = item;

    if (!productSlug || !quantity) {
      return c.json(
        { error: "Each item must include productSlug and quantity." },
        400
      );
    }

    const product = await c.env.runQuery(api.inventory.products.getByIdOrSlug, {
      identifier: productSlug,
      storeId: storeId as Id<"store">,
      filters: { isVisible: false },
    });

    if (!product) {
      return c.json(
        { error: `Product not found for slug '${productSlug}'.` },
        404
      );
    }

    type Sku = {
      _id: Id<"productSku">;
      sku: string;
      price: number;
      quantityAvailable: number;
    };

    const skus: Sku[] = (product.skus ?? []) as any;
    const purchasableSku = skuHint
      ? skus.find(
          (s: Sku) => s.sku === skuHint && s.price > 0 && s.quantityAvailable > 0
        )
      : skus.find((s: Sku) => s.price > 0 && s.quantityAvailable > 0);

    if (!purchasableSku) {
      return c.json(
        {
          error: skuHint
            ? `No purchasable SKU found for '${productSlug}' (${skuHint}).`
            : `No purchasable SKU found for '${productSlug}'.`,
        },
        404
      );
    }

    await c.env.runMutation(api.storeFront.bagItem.addItemToBag, {
      productId: product._id as Id<"product">,
      quantity,
      storeFrontUserId: guestId,
      bagId,
      productSkuId: purchasableSku._id,
      productSku: purchasableSku.sku,
    });

    products.push({
      price: purchasableSku.price,
      productId: product._id as Id<"product">,
      productSku: purchasableSku.sku,
      productSkuId: purchasableSku._id,
      quantity,
    });

    totalAmount += purchasableSku.price * quantity;
  }

  const checkoutResult = await c.env.runMutation(
    api.storeFront.checkoutSession.create,
    {
      storeId: storeId as Id<"store">,
      storeFrontUserId: guestId,
      products,
      bagId,
      amount: totalAmount * 100,
    }
  );

  if (!checkoutResult.success) {
    return c.json(
      {
        error: (checkoutResult as any).message ?? "Unable to create checkout session.",
        unavailableProducts: (checkoutResult as any).unavailableProducts ?? [],
      },
      400
    );
  }

  if (!STOREFRONT_ACTOR_SIGNING_KEY) {
    return c.json({ error: "Actor signing key is not configured." }, 500);
  }

  const requestingActor = await getActorClaims(c);

  const actorToken = await new SignJWT({
    storeId,
    organizationId,
    actorType: "guest",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(guestId)
    .setIssuedAt()
    .sign(encoder.encode(STOREFRONT_ACTOR_SIGNING_KEY));

  const actor = {
    actorId: guestId,
    actorType: "guest" as const,
    organizationId,
    requestedBy: requestingActor?.actorId,
    storeId,
  };

  return c.json({
    actor,
    actorToken,
    bagId,
    checkoutPath: "/shop/checkout",
    checkoutSession: (checkoutResult as any).session,
    checkoutSessionId: (checkoutResult as any).session._id,
    marker,
  });
});

export { e2eRoutes };

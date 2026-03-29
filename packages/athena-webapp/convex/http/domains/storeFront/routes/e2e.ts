import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { SignJWT } from "jose";
import {
  enforceActorStoreAccess,
  getActorClaims,
} from "./actorAuth";
import { STOREFRONT_ACTOR_SIGNING_KEY } from "../../../../env";

const e2eRoutes: HonoWithConvex<ActionCtx> = new Hono();
const encoder = new TextEncoder();

type BootstrapItem = {
  productSlug: string;
  quantity: number;
  sku?: string;
};

function createMarker() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createActorToken({
  actorId,
  actorType,
  organizationId,
  storeId,
}: {
  actorId: string;
  actorType: "guest" | "user";
  organizationId: string;
  storeId: string;
}) {
  if (!STOREFRONT_ACTOR_SIGNING_KEY) {
    throw new Error("Storefront actor signing key is not configured.");
  }

  return await new SignJWT({
    actorType,
    organizationId,
    storeId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(actorId)
    .setIssuedAt()
    .sign(encoder.encode(STOREFRONT_ACTOR_SIGNING_KEY));
}

e2eRoutes.post("/checkout/bootstrap", async (c) => {
  const authResponse = await enforceActorStoreAccess(c);
  if (authResponse) {
    return authResponse;
  }

  const organizationId = c.req.param("organizationId");
  const storeId = c.req.param("storeId");
  if (!organizationId || !storeId) {
    return c.json({ error: "Invalid route context." }, 400);
  }
  const claims = await getActorClaims(c);
  const body = await c.req.json();
  const marker =
    typeof body.marker === "string" && body.marker.trim().length > 0
      ? body.marker.trim()
      : createMarker();
  const items = Array.isArray(body.items) ? (body.items as BootstrapItem[]) : [];

  if (items.length === 0) {
    return c.json({ error: "At least one item is required." }, 400);
  }

  let guest = await c.env.runQuery(api.storeFront.guest.getByMarker, {
    marker,
  });

  if (!guest) {
    guest = await c.env.runMutation(api.storeFront.guest.create, {
      marker,
      creationOrigin: "e2e",
      storeId: storeId as Id<"store">,
      organizationId: organizationId as Id<"organization">,
    });
  }

  if (!guest) {
    return c.json({ error: "Unable to create guest actor." }, 500);
  }

  let bag = await c.env.runQuery(api.storeFront.bag.getByUserId, {
    storeFrontUserId: guest._id,
  });

  if (!bag) {
    bag = await c.env.runMutation(api.storeFront.bag.create, {
      storeFrontUserId: guest._id,
      storeId: storeId as Id<"store">,
    });
  }

  await c.env.runMutation(api.storeFront.bag.clearBag, {
    id: bag._id as Id<"bag">,
  });

  const resolvedItems = [];

  for (const item of items) {
    if (!item?.productSlug || !item?.quantity || item.quantity < 1) {
      return c.json(
        { error: "Each item must include productSlug and quantity." },
        400
      );
    }

    const product = await c.env.runQuery(api.inventory.products.getByIdOrSlug, {
      identifier: item.productSlug,
      storeId: storeId as Id<"store">,
      filters: { isVisible: true },
    });

    if (!product) {
      return c.json(
        { error: `Product not found for slug '${item.productSlug}'.` },
        404
      );
    }

    const selectedSku =
      (item.sku
        ? product.skus.find((candidate: any) => candidate.sku === item.sku)
        : undefined) ||
      product.skus.find(
        (candidate: any) =>
          typeof candidate.price === "number" &&
          candidate.price > 0 &&
          candidate.quantityAvailable >= item.quantity
      ) ||
      product.skus.find(
        (candidate: any) =>
          typeof candidate.price === "number" && candidate.price > 0
      );

    if (!selectedSku) {
      return c.json(
        {
          error: `No purchasable SKU found for '${item.productSlug}'${item.sku ? ` (${item.sku})` : ""}.`,
        },
        404
      );
    }

    const resolvedItem = {
      productId: product._id as Id<"product">,
      productSkuId: selectedSku._id as Id<"productSku">,
      productSku: selectedSku.sku as string,
      quantity: item.quantity,
      price: selectedSku.price as number,
    };

    resolvedItems.push(resolvedItem);

    await c.env.runMutation(api.storeFront.bagItem.addItemToBag, {
      bagId: bag._id as Id<"bag">,
      productId: resolvedItem.productId,
      productSkuId: resolvedItem.productSkuId,
      productSku: resolvedItem.productSku,
      quantity: resolvedItem.quantity,
      storeFrontUserId: guest._id,
    });
  }

  const subtotal = resolvedItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const checkoutSession = await c.env.runMutation(
    api.storeFront.checkoutSession.create,
    {
      storeId: storeId as Id<"store">,
      storeFrontUserId: guest._id,
      bagId: bag._id as Id<"bag">,
      amount: subtotal * 100,
      products: resolvedItems,
    }
  );

  if (!checkoutSession?.success || !checkoutSession.session) {
    return c.json(
      {
        error:
          checkoutSession?.message || "Unable to create checkout session.",
        unavailableProducts: checkoutSession?.unavailableProducts || [],
      },
      400
    );
  }

  const actorToken = await createActorToken({
    actorId: guest._id,
    actorType: "guest",
    organizationId,
    storeId,
  });

  return c.json({
    actor: {
      actorId: guest._id,
      actorType: "guest",
      organizationId,
      storeId,
      requestedBy: claims?.actorId,
    },
    actorToken,
    bagId: bag._id,
    checkoutPath: "/shop/checkout",
    checkoutSession: checkoutSession.session,
    checkoutSessionId: checkoutSession.session._id,
    marker,
  });
});

export { e2eRoutes };

import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  getStoreDataFromRequest,
  getStorefrontUserFromRequest,
} from "../../../utils";

const storeRoutes: HonoWithConvex<ActionCtx> = new Hono();

storeRoutes.get("/promoCodes", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  try {
    const res = await c.env.runQuery(api.inventory.promoCode.getAll, {
      storeId: storeId,
    });

    return c.json(res);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

storeRoutes.get("/:storeId", async (c) => {
  const { storeId } = c.req.param();
  const organizationId = c.req.param("organizationId");

  if (!organizationId) {
    return c.json({ error: "Organization id missing" }, 404);
  }

  const store = await c.env.runQuery(api.inventory.stores.getByIdOrSlug, {
    identifier: storeId,
    organizationId: organizationId as Id<"organization">,
  });

  if (!store) {
    return c.json({ error: "Store with identifier not found" }, 400);
  }

  return c.json(store);
});

storeRoutes.post("/promoCodes", async (c) => {
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  const { code } = await c.req.json();

  try {
    const res = await c.env.runMutation(api.inventory.promoCode.redeem, {
      code,
      storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    });

    return c.json(res);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

export { storeRoutes };

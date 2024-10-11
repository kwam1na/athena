import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const storeRoutes: HonoWithConvex<ActionCtx> = new Hono();

storeRoutes.post("/", async (c) => {
  const data = await c.req.json();

  return c.json({});
});

storeRoutes.get("/", async (c) => {
  const organizationId = c.req.param("organizationId");

  return c.json({});
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

storeRoutes.put("/:storeId", async (c) => {
  const { storeId } = c.req.param();

  const data = await c.req.json();

  return c.json({});
});

storeRoutes.delete("/:storeId", async (c) => {
  const { storeId } = c.req.param();

  return c.json({});
});

export { storeRoutes };

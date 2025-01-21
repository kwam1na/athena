import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";

const storefrontRoutes: HonoWithConvex<ActionCtx> = new Hono();

storefrontRoutes.get("/", async (c) => {
  const storeName = c.req.query("storeName");

  if (!storeName) {
    return c.json({ error: "Store name missing" }, 404);
  }

  const store = await c.env.runQuery(api.inventory.stores.findByName, {
    name: storeName,
  });

  return c.json(store);
});

export { storefrontRoutes };

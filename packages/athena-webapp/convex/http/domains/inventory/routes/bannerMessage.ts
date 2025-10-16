import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getStoreDataFromRequest } from "../../../utils";

const bannerMessageRoutes: HonoWithConvex<ActionCtx> = new Hono();

bannerMessageRoutes.get("/", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);

  if (!storeId)
    return c.json({ error: "Missing data to retrieve banner message" }, 400);

  const bannerMessage = await c.env.runQuery(api.inventory.bannerMessage.get, {
    storeId: storeId as Id<"store">,
  });

  return c.json({ bannerMessage });
});

export { bannerMessageRoutes };

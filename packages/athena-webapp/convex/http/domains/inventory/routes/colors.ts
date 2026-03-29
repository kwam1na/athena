import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getStoreDataFromRequest } from "../../../utils";

const colorRoutes: HonoWithConvex<ActionCtx> = new Hono();

colorRoutes.get("/", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);

  if (!storeId)
    return c.json({ error: "Missing data to retrieve colors" }, 400);

  const colors = await c.env.runQuery(api.inventory.colors.getAll, {
    storeId: storeId as Id<"store">,
  });

  return c.json({ colors });
});

export { colorRoutes };

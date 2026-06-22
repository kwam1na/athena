import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getStoreDataFromRequest } from "../../../utils";

const bannerMessageRoutes: HonoWithConvex<ActionCtx> = new Hono();

export const resolvePublicBannerMessage = async ({
  runQuery,
  storeId,
  nowMs,
}: {
  runQuery: ActionCtx["runQuery"];
  storeId?: string;
  nowMs: number;
}): Promise<{ status: number; body: unknown }> => {
  if (!storeId) {
    return {
      status: 400,
      body: { error: "Missing data to retrieve banner message" },
    };
  }

  const bannerMessage = await runQuery(
    api.inventory.bannerMessage.getPublicActive,
    {
      storeId: storeId as Id<"store">,
      nowMs,
    }
  );

  return {
    status: 200,
    body: { bannerMessage },
  };
};

bannerMessageRoutes.get("/", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);
  const result = await resolvePublicBannerMessage({
    runQuery: c.env.runQuery,
    storeId,
    nowMs: Date.now(),
  });

  return c.json(result.body, result.status as 200 | 400);
});

export { bannerMessageRoutes };

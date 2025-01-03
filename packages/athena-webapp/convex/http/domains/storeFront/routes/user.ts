import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const userRoutes: HonoWithConvex<ActionCtx> = new Hono();

userRoutes.get("/:userId", async (c) => {
  const { userId } = c.req.param();

  const user = await c.env.runQuery(api.storeFront.user.getById, {
    id: userId as Id<"storeFrontUser">,
  });

  return c.json(user);
});

export { userRoutes };

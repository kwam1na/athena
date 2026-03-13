import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { enforceActorAccess } from "./actorAuth";

const userRoutes: HonoWithConvex<ActionCtx> = new Hono();

userRoutes.use("/:userId", async (c, next) => {
  const response = await enforceActorAccess(c, "userId");
  if (response) {
    return response;
  }
  await next();
});

userRoutes.use("/:userId/*", async (c, next) => {
  const response = await enforceActorAccess(c, "userId");
  if (response) {
    return response;
  }
  await next();
});

userRoutes.get("/:userId", async (c) => {
  const { userId } = c.req.param();

  const user = await c.env.runQuery(api.storeFront.user.getById, {
    id: userId as Id<"storeFrontUser">,
  });

  return c.json(user);
});

userRoutes.put("/:userId", async (c) => {
  const { userId } = c.req.param();

  const {
    email,
    firstName,
    lastName,
    phoneNumber,
    shippingAddress,
    billingAddress,
  } = await c.req.json();

  const user = await c.env.runMutation(api.storeFront.user.update, {
    id: userId as Id<"storeFrontUser">,
    email,
    firstName,
    lastName,
    shippingAddress,
    billingAddress,
    phoneNumber,
  });

  return c.json(user);
});

export { userRoutes };

import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { get } from "../../../../storeFront/onlineOrder";
import { getCookie } from "hono/cookie";
import { getActorClaims } from "./actorAuth";

const meRoutes: HonoWithConvex<ActionCtx> = new Hono();

meRoutes.get("/", async (c) => {
  const userId = getCookie(c, "user_id");
  const claims = await getActorClaims(c);
  const actorUserId =
    claims?.actorType === "user"
      ? (claims.actorId as Id<"storeFrontUser">)
      : undefined;

  if (!userId && !actorUserId) {
    return c.json(null, 200);
  }

  try {
    const user = await c.env.runQuery(api.storeFront.user.getById, {
      id: (userId || actorUserId) as Id<"storeFrontUser">,
    });

    return c.json(user);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

meRoutes.put("/", async (c) => {
  const userId = getCookie(c, "user_id");
  const claims = await getActorClaims(c);
  const actorUserId =
    claims?.actorType === "user"
      ? (claims.actorId as Id<"storeFrontUser">)
      : undefined;

  if (!userId && !actorUserId) {
    return c.json({ error: "User id missing" }, 404);
  }

  const {
    email,
    firstName,
    lastName,
    phoneNumber,
    shippingAddress,
    billingAddress,
  } = await c.req.json();

  const user = await c.env.runMutation(api.storeFront.user.update, {
    id: (userId || actorUserId) as Id<"storeFrontUser">,
    email,
    firstName,
    lastName,
    shippingAddress,
    billingAddress,
    phoneNumber,
  });

  return c.json(user);
});

export { meRoutes };

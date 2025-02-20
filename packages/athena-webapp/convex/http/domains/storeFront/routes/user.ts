import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie } from "hono/cookie";

const userRoutes: HonoWithConvex<ActionCtx> = new Hono();

userRoutes.get("/:userId", async (c) => {
  const { userId } = c.req.param();

  if (userId == "me") {
    const userId = getCookie(c, "user_id");

    if (!userId) {
      return c.json(null, 200);
    }

    try {
      const user = await c.env.runQuery(api.storeFront.user.getById, {
        id: userId as Id<"storeFrontUser">,
      });

      return c.json(user);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }

  try {
    const user = await c.env.runQuery(api.storeFront.user.getById, {
      id: userId as Id<"storeFrontUser">,
    });

    return c.json(user);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
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

  if (userId == "me") {
    const userId = getCookie(c, "user_id");

    if (!userId) {
      return c.json(null, 200);
    }

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
  }

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

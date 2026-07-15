import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie } from "hono/cookie";

const userRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Only the cookie-authenticated user may be read or updated. Storefront user
// records are keyed by client-visible Convex IDs, so serving an arbitrary
// `:userId` from the path would expose/tamper with any customer's PII.
userRoutes.get("/:userId", async (c) => {
  const { userId: param } = c.req.param();
  const userId = getCookie(c, "user_id");

  if (param !== "me") {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (!userId) {
    return c.json(null, 200);
  }

  try {
    const user = await c.env.runQuery(internal.storeFront.user.getById, {
      id: userId as Id<"storeFrontUser">,
    });

    return c.json(user);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

userRoutes.put("/:userId", async (c) => {
  const { userId: param } = c.req.param();

  if (param !== "me") {
    return c.json({ error: "Forbidden" }, 403);
  }

  // A storeFrontUser update must be keyed to the authenticated user cookie, not
  // a guest cookie (guests have no storeFrontUser record to update).
  const userId = getCookie(c, "user_id");

  if (!userId) {
    return c.json(null, 200);
  }

  const {
    email,
    firstName,
    lastName,
    phoneNumber,
    shippingAddress,
    billingAddress,
  } = await c.req.json();

  const user = await c.env.runMutation(internal.storeFront.user.update, {
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

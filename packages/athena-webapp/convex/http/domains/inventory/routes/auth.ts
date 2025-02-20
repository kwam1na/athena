import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { getStoreDataFromRequest } from "../../../utils";
import { Id } from "../../../../_generated/dataModel";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

const authRoutes: HonoWithConvex<ActionCtx> = new Hono();

authRoutes.post("/verify", async (c) => {
  const { storeId, organizationId } = getStoreDataFromRequest(c);

  const { email, firstName, lastName, code } = await c.req.json();

  if (!storeId || !organizationId) {
    return c.json({ error: "Store or organization id missing" }, 404);
  }

  if (code) {
    try {
      const res = await c.env.runMutation(api.storeFront.auth.verifyCode, {
        code,
        email,
        storeId: storeId as Id<"store">,
        organizationId: organizationId as Id<"organization">,
      });

      if (res.user) {
        setCookie(c, "user_id", res.user._id, {
          path: "/",
          secure: true,
          domain: "wigclub.store",
          httpOnly: true,
          sameSite: "None",
          maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
        });
      }

      return c.json(res);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }

  if (email) {
    const res = await c.env.runAction(
      api.storeFront.auth.sendVerificationCodeViaProvider,
      {
        email,
        firstName,
        lastName,
        storeId: storeId as Id<"store">,
      }
    );

    return c.json(res);
  }

  return c.json({});
});

authRoutes.post("/logout", async (c) => {
  setCookie(c, "user_id", "", {
    path: "/",
    secure: true,
    domain: "wigclub.store",
    httpOnly: true,
    sameSite: "None",
    maxAge: 0, // Expires immediately
  });

  console.log("deleted cookie");

  const co = getCookie(c, "user_id");

  console.log("cookie: ", co);

  return c.json({ success: true });
});

export { authRoutes };

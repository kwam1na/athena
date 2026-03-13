import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";

const authRoutes: HonoWithConvex<ActionCtx> = new Hono();

authRoutes.post("/verify", async (c) => {
  const { email, firstName, lastName, code } = await c.req.json();

  // if (code) {
  //   try {
  //     const res = await c.env.runMutation(api.storeFront.auth.verifyCode, {
  //       code,
  //       email,
  //       storeId: storeId as Id<"store">,
  //       organizationId: organizationId as Id<"organization">,
  //     });

  //     return c.json(res);
  //   } catch (e) {
  //     return c.json({ error: (e as Error).message }, 400);
  //   }
  // }

  if (email) {
    const res = await c.env.runAction(
      api.inventory.auth.sendVerificationCodeViaProvider,
      {
        email,
        firstName,
        lastName,
      }
    );

    return c.json(res);
  }

  return c.json({});
});

export { authRoutes };

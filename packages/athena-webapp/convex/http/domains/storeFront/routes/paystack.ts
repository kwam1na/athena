import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const paystackRoutes: HonoWithConvex<ActionCtx> = new Hono();

paystackRoutes.post("/", async (c) => {
  const payload = await c.req.json();

  console.log(payload);

  const { checkout_session_id } = payload?.data?.metadata || {};

  console.log("using session id =>", checkout_session_id);

  if (payload?.event == "charge.success" && checkout_session_id) {
    await c.env.runMutation(
      internal.storeFront.checkoutSession.updateCheckoutSession,
      {
        id: checkout_session_id as Id<"checkoutSession">,
        hasCompletedPayment: true,
        amount: payload.data.amount,
      }
    );
  }

  return c.json({});
});

export { paystackRoutes };

import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";

const posTransactionRoutes: HonoWithConvex<ActionCtx> = new Hono();
const customerMessagingApi = (api as any).customerMessaging;

posTransactionRoutes.get("/receipt-shares/:token", async (c) => {
  const { token } = c.req.param();

  try {
    const transaction = await c.env.runQuery(
      customerMessagingApi.public.getReceiptByShareToken,
      { token },
    );

    if (!transaction) {
      return c.json({ error: "Receipt not found" }, 404);
    }

    return c.json(transaction);
  } catch {
    return c.json({ error: "Receipt not found" }, 404);
  }
});

export { posTransactionRoutes };

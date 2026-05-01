import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const posTransactionRoutes: HonoWithConvex<ActionCtx> = new Hono();

posTransactionRoutes.get("/:transactionId", async (c) => {
  const { transactionId } = c.req.param();

  try {
    const transaction = await c.env.runQuery(
      api.pos.public.transactions.getTransactionById,
      {
        transactionId: transactionId as Id<"posTransaction">,
      },
    );

    if (!transaction) {
      return c.json({ error: "Transaction not found" }, 404);
    }

    return c.json(transaction);
  } catch (error) {
    return c.json({ error: "Invalid transaction id" }, 400);
  }
});

export { posTransactionRoutes };

import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { admitHttpRead } from "../../../../platform/operationAdmission";
import { getReceiptShareRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";

const posTransactionRoutes: HonoWithConvex<ActionCtx> = new Hono();

posTransactionRoutes.get(
  "/receipt-shares/:token",
  admitHttpRead(getReceiptShareRouteReadDefinition, async (c) => {
    const { token } = c.req.param();

    // The share token in the path IS the boundary here — the recipient of a
    // receipt link never had a storefront cookie — so the route stays public
    // and the untyped `(api as any)` hop is replaced by the internal sibling.
    //
    // There is no `catch` around this call, deliberately. The query answers a
    // missing token, an expired token and a token whose transaction is gone
    // with the same `null` — that IS the not-found domain outcome, and the
    // branch below is the whole translation of it. It therefore throws only on
    // a genuine fault, and the bare `catch` that used to report every one of
    // those as 404 made a broken receipt lookup indistinguishable from a
    // receipt that does not exist: the customer holding a valid link was told
    // it was wrong, and monitoring saw a clean 4xx instead of an outage.
    const transaction = await c.env.runQuery(
      internal.customerMessaging.public.getReceiptByShareTokenInternal,
      { token },
    );

    if (!transaction) {
      return c.json({ error: "Receipt not found" }, 404);
    }

    return c.json(transaction);
  }),
);

export { posTransactionRoutes };

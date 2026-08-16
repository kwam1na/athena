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

    try {
      // The share token in the path IS the boundary here — the recipient of a
      // receipt link never had a storefront cookie — so the route stays public
      // and the untyped `(api as any)` hop is replaced by the internal sibling.
      const transaction = await c.env.runQuery(
        internal.customerMessaging.public.getReceiptByShareTokenInternal,
        { token },
      );

      if (!transaction) {
        return c.json({ error: "Receipt not found" }, 404);
      }

      return c.json(transaction);
    } catch {
      return c.json({ error: "Receipt not found" }, 404);
    }
  }),
);

export { posTransactionRoutes };

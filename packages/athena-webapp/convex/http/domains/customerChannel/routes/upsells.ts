import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { admitHttpRead } from "../../../../platform/operationAdmission";
import { getUpsellRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import {
  admittedCustomerId,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const upsellRoutes: HonoWithConvex<ActionCtx> = new Hono();

upsellRoutes.get(
  "/",
  admitHttpRead(getUpsellRouteReadDefinition, async (c, admitted) => {
    const owner = requireAdmittedCustomerOwner(admitted);

    const category = c.req.query("category");
    const minAgeHoursParam = c.req.query("minAgeHours");
    const minAgeHours = minAgeHoursParam ? Number(minAgeHoursParam) : undefined;

    try {
      const lastProduct = await c.env.runQuery(
        internal.storeFront.user.getLastViewedProductInternal,
        {
          id: admittedCustomerId(owner),
          category,
          ...(Number.isFinite(minAgeHours as number)
            ? { minAgeHours: minAgeHours as number }
            : {}),
          owner,
        },
      );

      return c.json(lastProduct);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }),
);

export { upsellRoutes };

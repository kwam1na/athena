import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { admitHttpRead } from "../../../../platform/operationAdmission";
import { getUserOffersRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import {
  admittedCustomerId,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const userOffersRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * Get offers eligibility for the current user
 * GET /user-offers
 */
userOffersRoutes.get(
  "/",
  admitHttpRead(getUserOffersRouteReadDefinition, async (c, admitted) => {
    try {
      // Shopper and store both come from the admitted claim; the `store_id`
      // cookie is only ever cross-checked by the adapter.
      const owner = requireAdmittedCustomerOwner(admitted);

      const eligibility = await c.env.runQuery(
        internal.storeFront.userOffers.getEligibility,
        {
          storeFrontUserId: admittedCustomerId(owner),
          storeId: owner.storeId,
          currentTimeMs: Date.now(),
        },
      );

      return c.json(eligibility);
    } catch (error) {
      console.error("Error checking user offers eligibility:", error);
      return c.json({ error: "Failed to check offers eligibility" }, 500);
    }
  }),
);

export { userOffersRoutes };

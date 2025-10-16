import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getStorefrontUserFromRequest } from "../../../utils";

const upsellRoutes: HonoWithConvex<ActionCtx> = new Hono();

upsellRoutes.get("/", async (c) => {
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json(null, 200);
  }

  // const ids = [
  //   "md7bj057x4h3nnwxjgj0rfvadn7ggez0",
  //   "md72weypcwt2mgjmxsbayxdpt57jnwze",
  //   "kh7dn0q87d7jj7nxh78vbmhck97g5d6g",
  //   "nx7dya3regfngq75mr1r7b5rq97akt8z",
  // ];

  // if (!ids.includes(userId)) {
  //   return c.json(null);
  // }

  const category = c.req.query("category");
  const minAgeHoursParam = c.req.query("minAgeHours");
  const minAgeHours = minAgeHoursParam ? Number(minAgeHoursParam) : undefined;

  try {
    const lastProduct = await c.env.runQuery(
      api.storeFront.user.getLastViewedProduct,
      {
        id: userId as Id<"storeFrontUser">,
        category,
        ...(Number.isFinite(minAgeHours as number)
          ? { minAgeHours: minAgeHours as number }
          : {}),
      }
    );

    return c.json(lastProduct);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

export { upsellRoutes };

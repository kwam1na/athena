import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { setCookie } from "hono/cookie";
import { getStorefrontUserFromRequest } from "../../../utils";

const storefrontRoutes: HonoWithConvex<ActionCtx> = new Hono();

storefrontRoutes.get("/", async (c) => {
  const storeName = c.req.query("storeName");
  const marker = c.req.query("marker");
  const asNewUser = c.req.query("asNewUser");

  if (!storeName) {
    return c.json({ error: "Store name missing" }, 404);
  }

  const store = await c.env.runQuery(api.inventory.stores.findByName, {
    name: storeName,
  });

  const userId = getStorefrontUserFromRequest(c);

  if (!userId && asNewUser === "true") {
    let guest = await c.env.runQuery(api.storeFront.guest.getByMarker, {
      marker,
    });

    if (!guest) {
      guest = await c.env.runMutation(api.storeFront.guest.create, {
        marker,
        creationOrigin: "storefront",
        storeId: store?._id,
        organizationId: store?.organizationId,
      });
    }

    if (guest) {
      setCookie(c, "guest_id", guest._id, {
        path: "/",
        secure: true,
        domain: "wigclub.store",
        httpOnly: true,
        sameSite: "None",
        maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
      });
    }
  }

  if (store) {
    setCookie(c, "organization_id", store.organizationId, {
      path: "/",
      secure: true,
      domain: "wigclub.store",
      httpOnly: true,
      sameSite: "None",
      maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
    });

    setCookie(c, "store_id", store._id, {
      path: "/",
      secure: true,
      domain: "wigclub.store",
      httpOnly: true,
      sameSite: "None",
      maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
    });
  }

  c.header("Access-Control-Allow-Origin", "https://wigclub.store");
  c.header("Access-Control-Allow-Credentials", "true");

  return c.json(store);
});

storefrontRoutes.post("/inventory/batch", async (c) => {
  try {
    const body = await c.req.json();
    const { skuIds } = body;

    if (!skuIds || !Array.isArray(skuIds)) {
      return c.json({ error: "skuIds array is required" }, 400);
    }

    const inventory = await c.env.runQuery(
      api.inventory.productSku.getInventoryBySkuIds,
      {
        skuIds: skuIds as Array<Id<"productSku">>,
      }
    );

    return c.json({ inventory });
  } catch (error) {
    console.error("Failed to fetch batch inventory:", error);
    return c.json({ error: "Failed to fetch inventory data" }, 500);
  }
});

export { storefrontRoutes };

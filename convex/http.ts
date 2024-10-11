import { Hono } from "hono";
import { cors } from "hono/cors";
import { HonoWithConvex, HttpRouterWithHono } from "convex-helpers/server/hono";
import { ActionCtx } from "./_generated/server";
import {
  categoryRoutes,
  orgRoutes,
  productRoutes,
  storeRoutes,
  subcategoryRoutes,
} from "./http/domains/inventory/routes";
import { bagRoutes } from "./http/domains/storeFront/routes";

const app: HonoWithConvex<ActionCtx> = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => {
      return origin;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
  })
);

app.route("/organizations", orgRoutes);

app.route("/organizations/:organizationId/stores", storeRoutes);

app.route(
  "/organizations/:organizationId/stores/:storeId/products",
  productRoutes
);

app.route(
  "/organizations/:organizationId/stores/:storeId/categories",
  categoryRoutes
);

app.route(
  "/organizations/:organizationId/stores/:storeId/subcategories",
  subcategoryRoutes
);

app.route("/customers/:customerId/bags", bagRoutes);

export default new HttpRouterWithHono(app);

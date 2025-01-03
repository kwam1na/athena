import { Hono } from "hono";
import { cors } from "hono/cors";
import { orgRoutes } from "./src/domains/inventory/routes/organizations";
import { storeRoutes } from "src/domains/inventory/routes/stores";
import { productRoutes } from "src/domains/inventory/routes/products";
import { categoryRoutes } from "src/domains/inventory/routes/categories";
import { subcategoryRoutes } from "src/domains/inventory/routes/subcategories";
import { bagRoutes } from "src/domains/store-front/bag";

const app = new Hono();

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

app.route("/users/:userId/bags", bagRoutes);

export default {
  port: 4000,
  fetch: app.fetch,
};

import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
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
import { httpRouter } from "convex/server";
import { guestRoutes } from "./http/domains/storeFront/routes/guest";
import { colorRoutes } from "./http/domains/inventory/routes/colors";

const app: HonoWithConvex<ActionCtx> = new Hono();

const http = httpRouter();

auth.addHttpRoutes(http);

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

app.route("/organizations/:organizationId/stores/:storeId/colors", colorRoutes);

// app.route(
//   "/organizations/:organizationId/customers/:customerId/bags",
//   bagRoutes
// );

app.route("/organizations/:organizationId/guests", guestRoutes);

app.get("/.well-known/openid-configuration", async (c) => {
  const [httpAction] = http.lookup(
    "/.well-known/openid-configuration",
    "GET"
  ) as any;
  return httpAction(c.env, c.req);
});

app.get("/.well-known/jwks.json", async (c) => {
  const [httpAction] = http.lookup("/.well-known/jwks.json", "GET") as any;
  return httpAction(c.env, c.req);
});

app.get("/api/auth/signin/*", async (c) => {
  const [httpAction] = http.lookup("/api/auth/signin/foo", "GET") as any;
  return httpAction(c.env, c.req);
});

app.on(["GET", "POST"], "/api/auth/callback/*", async (c) => {
  const [httpAction] = http.lookup(
    "/api/auth/callback/foo",
    c.req.method as any
  ) as any;
  return httpAction(c.env, c.req);
});

export default new HttpRouterWithHono(app);

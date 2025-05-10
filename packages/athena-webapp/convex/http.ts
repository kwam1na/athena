import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { HonoWithConvex, HttpRouterWithHono } from "convex-helpers/server/hono";
import { ActionCtx } from "./_generated/server";
import {
  analyticsRoutes,
  authRoutes,
  categoryRoutes,
  orgRoutes,
  productRoutes,
  storeRoutes,
  subcategoryRoutes,
} from "./http/domains/inventory/routes";
import {
  bagRoutes,
  checkoutRoutes,
  onlineOrderRoutes,
  paystackRoutes,
  storefrontRoutes,
  upsellRoutes,
  userRoutes,
  reviewRoutes,
} from "./http/domains/storeFront/routes";
import { httpRouter } from "convex/server";
import { guestRoutes } from "./http/domains/storeFront/routes/guest";
import { colorRoutes } from "./http/domains/inventory/routes/colors";
import { savedBagRoutes } from "./http/domains/storeFront/routes/savedBag";

const app: HonoWithConvex<ActionCtx> = new Hono();

const http = httpRouter();

auth.addHttpRoutes(http);

app.use(
  "*",
  cors({
    origin: (origin) => {
      return origin;
    },
    allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  })
);

app.route("/upsells", upsellRoutes);

app.route("/stores", storeRoutes);

app.route("/storefront", storefrontRoutes);

app.route("/webhooks/paystack", paystackRoutes);

app.route("/analytics", analyticsRoutes);

app.route("/auth", authRoutes);

app.route("/organizations", orgRoutes);

app.route("/bags", bagRoutes);

app.route("/savedBags", savedBagRoutes);

app.route("/products", productRoutes);

app.route("/categories", categoryRoutes);

app.route("/subcategories", subcategoryRoutes);

app.route("/colors", colorRoutes);

app.route("/guests", guestRoutes);

app.route("/users", userRoutes);

app.route("/checkout", checkoutRoutes);

app.route("/orders", onlineOrderRoutes);

app.route("/reviews", reviewRoutes);

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

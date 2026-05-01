import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { HonoWithConvex, HttpRouterWithHono } from "convex-helpers/server/hono";
import { ActionCtx } from "./_generated/server";
import {
  analyticsRoutes,
  authRoutes,
  bannerMessageRoutes,
  categoryRoutes,
  orgRoutes,
  productRoutes,
  storeRoutes,
  subcategoryRoutes,
} from "./http/domains/core/routes";
import {
  onlineOrderRoutes,
  userRoutes,
  bagRoutes,
  checkoutRoutes,
  meRoutes,
  upsellRoutes,
  reviewRoutes,
  rewardsRoutes,
  paystackRoutes,
  storefrontRoutes,
  offersRoutes,
  userOffersRoutes,
  posTransactionRoutes,
} from "./http/domains/customerChannel/routes";
import { guestRoutes } from "./http/domains/customerChannel/routes/guest";
import { colorRoutes } from "./http/domains/core/routes/colors";
import { savedBagRoutes } from "./http/domains/customerChannel/routes/savedBag";
import { mtnMomoRoutes } from "./http/domains/moneyMovement/routes";

const app: HonoWithConvex<ActionCtx> = new Hono();

const http = new HttpRouterWithHono<ActionCtx>(app);

auth.addHttpRoutes(http);

app.use(
  "*",
  cors({
    origin: (origin) => {
      return origin;
    },
    allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  }),
);

app.get("/health", (c) => {
  return c.json({
    app: "athena-webapp-backend",
    status: "ok",
  });
});

app.route("/upsells", upsellRoutes);

app.route("/stores", storeRoutes);

app.route("/storefront", storefrontRoutes);

app.route("/webhooks/paystack", paystackRoutes);
app.route("/webhooks/mtn-momo", mtnMomoRoutes);

app.route("/analytics", analyticsRoutes);

app.route("/auth", authRoutes);

app.route("/banner-message", bannerMessageRoutes);

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

app.route("/me", meRoutes);

app.route("/rewards", rewardsRoutes);

app.route("/offers", offersRoutes);

app.route("/user-offers", userOffersRoutes);

app.route("/pos-transactions", posTransactionRoutes);

export default http;

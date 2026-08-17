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
  trackingEventRoutes,
  walkthroughRequestRoutes,
  landingFunnelEventRoutes,
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
  homepageSnapshotRoutes,
} from "./http/domains/customerChannel/routes";
import { guestRoutes } from "./http/domains/customerChannel/routes/guest";
import { colorRoutes } from "./http/domains/core/routes/colors";
import { savedBagRoutes } from "./http/domains/customerChannel/routes/savedBag";
import { mtnMomoRoutes } from "./http/domains/moneyMovement/routes";
import { whatsappMessagingRoutes } from "./http/domains/customerMessaging/routes/whatsapp";
import { harnessWaiverRoutes } from "./http/domains/core/routes/harnessWaivers";
import { healthRouteReadDefinition } from "./operationAdmission/domains/u11_httpCore_readDefinitions";
import { admitHttpRead } from "./platform/operationAdmission";
import { readStorefrontOriginAllowlist } from "./platform/storefrontOrigins";

const app: HonoWithConvex<ActionCtx> = new Hono();

const http = new HttpRouterWithHono<ActionCtx>(app);

// Convex Auth installs its own HTTP route family and is the trust root that
// mints the principals the admission adapters later resolve, so it is not
// admitted. It is registered here, exactly once, BEFORE the CORS middleware —
// its routes are a framework surface that manages its own headers, and moving
// it under the middleware would put the sign-in redirect chain behind an
// allowlist meant for storefront XHR.
auth.addHttpRoutes(http);

/**
 * Fixed origin allowlist, never a reflection of the request.
 *
 * The storefront claim cookies are `SameSite=None`, so reflecting whatever
 * `Origin` arrives while also sending `Access-Control-Allow-Credentials: true`
 * makes every customer route reachable from any site the visitor is browsing.
 * The list is exact-string and fails closed: an unset environment value allows
 * no origin at all, and an unlisted origin simply gets no
 * `Access-Control-Allow-Origin` header rather than a wildcard.
 *
 * `Vary: Origin` matters here: the response varies by request origin, so
 * without it a shared cache may serve one origin's
 * `Access-Control-Allow-Origin` to another, turning the allowlist into a
 * cache-poisoning primitive. Hono's `cors()` appends it for every
 * non-wildcard configuration, which this always is.
 *
 * That is a dependency on library behaviour, so it is pinned by a test
 * (`routerComposition.test.ts`) rather than by a second middleware. An earlier
 * attempt to "state it explicitly" appended it a second time and shipped
 * `Vary: Origin, Origin` — asserting a header twice is not a stronger
 * guarantee, it is a duplicate. The test is what makes a silent library change
 * fail loudly.
 */
app.use(
  "*",
  cors({
    origin: [...readStorefrontOriginAllowlist()],
    allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  }),
);

app.get(
  "/health",
  admitHttpRead(healthRouteReadDefinition, (c) =>
    c.json({
      app: "athena-webapp-backend",
      status: "ok",
    }),
  ),
);

app.route("/upsells", upsellRoutes);

app.route("/stores", storeRoutes);

app.route("/storefront", storefrontRoutes);

app.route("/homepage-snapshot", homepageSnapshotRoutes);

app.route("/webhooks/paystack", paystackRoutes);
app.route("/webhooks/mtn-momo", mtnMomoRoutes);
app.route("/webhooks/whatsapp", whatsappMessagingRoutes);

app.route("/analytics", analyticsRoutes);

app.route("/tracking-events", trackingEventRoutes);
app.route("/marketing/walkthrough-requests", walkthroughRequestRoutes);
app.route("/marketing/funnel-events", landingFunnelEventRoutes);
app.route("/harness/waivers", harnessWaiverRoutes);

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

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "release-checkout-items",
  { minutes: process.env.STAGE == "prod" ? 10 : 1440 },
  internal.storeFront.checkoutSession.releaseCheckoutItems,
  {}
);

crons.interval(
  "clear-abandoned-sessions",
  { minutes: process.env.STAGE == "prod" ? 30 : 1440 },
  internal.storeFront.checkoutSession.clearAbandonedSessions,
  {}
);

crons.interval(
  "complete-checkout-sessions",
  { minutes: process.env.STAGE == "prod" ? 30 : 1440 },
  internal.storeFront.checkoutSession.completeCheckoutSessions,
  {}
);

crons.interval(
  "clear-expired-fulfillment-restrictions",
  { minutes: process.env.STAGE == "prod" ? 10 : 1440 },
  internal.inventory.stores.clearExpiredRestrictions,
  {}
);

export default crons;

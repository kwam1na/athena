import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "release-checkout-items",
  { minutes: process.env.STAGE == "prod" ? 10 : 60 },
  internal.storeFront.checkoutSession.releaseCheckoutItems,
  {}
);

crons.interval(
  "clear-abandoned-sessions",
  { minutes: process.env.STAGE == "prod" ? 30 : 60 },
  internal.storeFront.checkoutSession.clearAbandonedSessions,
  {}
);

export default crons;

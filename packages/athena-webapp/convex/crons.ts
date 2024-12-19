import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "release-checkout-items",
  { minutes: 1 },
  internal.storeFront.checkoutSession.releaseCheckoutItems,
  {}
);

export default crons;

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
  (internal.storeFront.checkoutSession as any).clearAbandonedSessions,
  {}
);

crons.interval(
  "complete-checkout-sessions",
  { minutes: process.env.STAGE == "prod" ? 30 : 1440 },
  (internal.storeFront.checkoutSession as any).completeCheckoutSessions,
  {}
);

crons.interval(
  "release-pos-session-items",
  { minutes: process.env.STAGE == "prod" ? 10 : 1440 },
  internal.inventory.posSessions.releasePosSessionItems,
  {}
);

crons.interval(
  "release-expired-expense-sessions",
  { minutes: process.env.STAGE == "prod" ? 5 : 1440 },
  internal.inventory.expenseSessions.releaseExpenseSessionItems,
  {}
);

export default crons;

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "shared-demo-hourly-restore",
  { minuteUTC: 0 },
  (internal as any).sharedDemo.scheduledRestore.runHourlyRestore,
  {},
);

crons.interval("walkthrough-retention-cleanup", { hours: 24 }, internal.marketing.walkthroughRequestRetention.cleanupBatch, {});
crons.interval("landing-funnel-retention-cleanup", { hours: 24 }, internal.marketing.landingFunnelRetention.cleanupBatch, {});
crons.interval("walkthrough-notification-recovery", { minutes: 10 }, internal.marketing.walkthroughRequestNotifications.scheduleEligibleBatch, {});

crons.interval(
  "release-checkout-items",
  { minutes: process.env.STAGE == "prod" ? 10 : 1440 },
  internal.storeFront.checkoutSession.releaseCheckoutItems,
  {},
);

crons.interval(
  "clear-abandoned-sessions",
  { minutes: process.env.STAGE == "prod" ? 30 : 1440 },
  internal.storeFront.checkoutSession.clearAbandonedSessions,
  {},
);

crons.interval(
  "complete-checkout-sessions",
  { minutes: process.env.STAGE == "prod" ? 30 : 1440 },
  internal.storeFront.checkoutSession.completeCheckoutSessions,
  {},
);

// Unwedges POS terminals parked behind a burned upload sequence. The policy
// itself only escalates after the gap has aged well past this interval, so a
// frequent sweep costs little and shortens the stuck window to minutes rather
// than however long it takes someone to read a health alert.
crons.interval(
  "reconcile-pos-local-sync-gaps",
  { minutes: process.env.STAGE == "prod" ? 15 : 1440 },
  internal.pos.application.sync.reconcileSequenceGaps
    .reconcilePosLocalSyncSequenceGaps,
  {},
);

crons.interval(
  "release-pos-session-items",
  { minutes: process.env.STAGE == "prod" ? 10 : 1440 },
  internal.inventory.posSessions.releasePosSessionItems,
  {},
);

crons.interval(
  "release-expired-expense-sessions",
  { minutes: process.env.STAGE == "prod" ? 10 : 1440 },
  internal.inventory.expenseSessions.releaseExpenseSessionItems,
  {},
);

crons.interval(
  "auto-verify-payments",
  { minutes: process.env.STAGE == "prod" ? 10 : 1440 },
  internal.storeFront.payment.autoVerifyUnverifiedPayments,
  {},
);

if (process.env.STAGE == "prod") {
  crons.hourly(
    "daily-operations-automation",
    { minuteUTC: 0 },
    internal.operations.dailyOperationsAutomation.runConfiguredDailyOperationsAutomation,
    {},
  );
} else {
  crons.cron(
    "daily-operations-automation",
    "0 */2 * * *",
    internal.operations.dailyOperationsAutomation.runConfiguredDailyOperationsAutomation,
    {},
  );
}

// Safety net for store days that missed their eligibility window entirely. The
// window above is only ~4 hours wide, so a blocker that outlives it strands the
// day permanently; this sweep keeps revisiting owed days until they close or
// are escalated. Runs at half past the hour so it observes the state the
// primary automation just left behind rather than racing it.
if (process.env.STAGE == "prod") {
  crons.hourly(
    "owed-daily-close-sweep",
    { minuteUTC: 30 },
    internal.operations.owedDailyCloseSweep.runOwedDailyCloseSweep,
    {},
  );
} else {
  crons.cron(
    "owed-daily-close-sweep",
    "30 */2 * * *",
    internal.operations.owedDailyCloseSweep.runOwedDailyCloseSweep,
    {},
  );
}

// The ONE cron of the rebuilt reports layer. Work is queued as reportDirtyDay
// marks; this is their only consumer, and a crashed sweep leaves the marks in
// place for the next tick. Cadence trades overview freshness against
// subscription re-runs linearly — 5 minutes is the design's starting point,
// to be tuned on wigclub.
crons.interval(
  "reports sweep",
  { minutes: 5 },
  internal.reports.sweeper.sweep,
  {},
);

// The ONE cron of the notifications layer. Immediate kinds dispatch via
// runAfter(0) at emit; this sweep is the safety net that recovers expired
// delivery leases, fires due retries, and picks up intents whose scheduled
// dispatch never landed. A crashed sweep leaves the work for the next tick.
crons.interval(
  "notifications sweep",
  { minutes: 5 },
  internal.notifications.sweeper.sweep,
  {},
);

export default crons;

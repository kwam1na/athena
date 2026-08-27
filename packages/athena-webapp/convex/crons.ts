import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * The shared demo returns to its baseline once a day, at midnight.
 *
 * Midnight UTC IS the demo store's midnight: it runs `Africa/Accra`
 * (`DEFAULT_STORE_TIMEZONE` in `reports/operatingDay.ts`), which is UTC+0 all
 * year with no daylight saving. That alignment is the point rather than a
 * coincidence — the reset now lands on the same boundary the operating day
 * rolls over on, so a visitor never sees the baseline restored partway through
 * a trading day they were reading. A demo store in another zone would need
 * this hour moved to match its own midnight.
 */
crons.cron(
  "shared-demo-daily-restore",
  "0 0 * * *",
  (internal as any).sharedDemo.scheduledRestore.runDailyRestore,
  {},
);

/**
 * The lockout self-heal, kept on the OLD hourly rhythm on purpose.
 *
 * Admission rejects every visitor while the persisted `baselineVersion` trails
 * the constant in code. `scripts/deploy-vps.sh` migrates it right after
 * `convex deploy`, but if that step fails the demo stays locked until a
 * scheduled run repairs it — and waiting for midnight could mean a full day.
 *
 * This job only PROVISIONS: idempotent, non-destructive, and it begins no
 * restore lease, so it never wipes a visitor's activity. That separation is
 * what lets the reset move to midnight without lengthening the recovery time.
 */
crons.cron(
  "shared-demo-hourly-provision-heal",
  "0 * * * *",
  (internal as any).sharedDemo.scheduledRestore.runHourlyProvisionHeal,
  {},
);

// Agent harness retention: the short-lived (30-day) and standard (365-day)
// retention classes for prompts, scratch, replay payloads, claim support, and
// citations, plus due runtime-adapter cleanups. Bounded and self-continuing
// like the marketing cleanups below; a crashed pass leaves rows for the next.
crons.interval(
  "agent-harness-retention-sweep",
  { hours: 6 },
  internal.agentHarness.retention.sweepExpiredAgentContent,
  {},
);

// Agent harness repair safety net: stale executing attempts, turns that never
// reached running, and runs fenced by a compatibility-epoch advance. Each
// pass is bounded; repair never reopens a terminal run or duplicates work.
crons.interval(
  "agent-harness-repair-sweep",
  { minutes: process.env.STAGE == "prod" ? 5 : 60 },
  internal.agentHarness.retention.repairSweep,
  {},
);

// Agent harness completion outbox: committed answers whose runtime
// projection did not land (host crash, adapter hiccup) are projected again with
// backoff; projection is idempotent and never reopens a run.
crons.interval(
  "agent-harness-outbox-repair",
  { minutes: process.env.STAGE == "prod" ? 5 : 60 },
  internal.agentHarness.runtimeHost.repairCompletionOutbox,
  {},
);

crons.interval("walkthrough-retention-cleanup", { hours: 24 }, internal.marketing.walkthroughRequestRetention.cleanupBatch, {});
crons.interval("landing-funnel-retention-cleanup", { hours: 24 }, internal.marketing.landingFunnelRetention.cleanupBatch, {});
crons.interval("walkthrough-notification-recovery", { minutes: 10 }, internal.marketing.walkthroughRequestNotifications.scheduleEligibleBatch, {});

crons.interval(
  "pos-client-event-retention-cleanup",
  { hours: 24 },
  internal.pos.application.clientEventRetention.cleanupBatch,
  {},
);

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
  { minutes: process.env.STAGE == "prod" ? 5 : 60 },
  internal.notifications.sweeper.sweep,
  {},
);

// The ONE cron of the report verification family. It OBSERVES rather than
// produces: it re-derives its work set every tick from the run table plus each
// day's `certifiedFoldRevision`, so there is no queue to drain and a crashed
// tick simply leaves the same subjects selected for the next one — same
// declarative-liveness contract as the reports and notifications sweeps above.
//
// Hourly class in prod, at :47, chosen to sit clear of the two wall-clock
// hourly jobs: daily-operations-automation at :00 and owed-daily-close-sweep
// at :30. Note the reports and notifications sweeps use `crons.interval`
// (5 minutes), which Convex anchors to deploy time rather than the wall clock
// — their minutes drift and are unpredictable across deploys, so no minute can
// be chosen to avoid them. Racing the fold is handled structurally instead:
// selection defers any day still carrying a pending dirty mark.
//
// Non-prod runs every 6 hours at the same minute: verification is read-heavy
// and dev data is static, so a slow rhythm is enough to keep the path warm.
if (process.env.STAGE == "prod") {
  crons.hourly(
    "report-verification-sweep",
    { minuteUTC: 47 },
    internal.reports.verificationSweep.runVerificationSweep,
    {},
  );
} else {
  crons.cron(
    "report-verification-sweep",
    "47 */6 * * *",
    internal.reports.verificationSweep.runVerificationSweep,
    {},
  );
}

export default crons;

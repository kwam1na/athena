import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  VERIFICATION_TICK_MINUTES_NON_PROD,
  VERIFICATION_TICK_MINUTES_PROD,
} from "./reports/verificationSweep";

describe("Convex cron registration", () => {
  it("registers the shared demo restore at midnight, once a day", () => {
    const source = readFileSync("convex/crons.ts", "utf8");
    expect(source).toContain('"shared-demo-daily-restore"');
    expect(source).toContain("sharedDemo.scheduledRestore.runDailyRestore");
    // Midnight UTC, which is the demo store's own midnight (Africa/Accra).
    expect(source).toContain('"0 0 * * *"');
    // The previous hourly RESTORE must be gone, not merely joined by a daily
    // one: two schedules would wipe visitor activity mid-day all over again.
    expect(source).not.toContain('"shared-demo-hourly-restore"');
    expect(source).not.toContain("runHourlyRestore,");
  });

  it("keeps the demo's lockout self-heal on an hourly rhythm", () => {
    // Provisioning is idempotent and begins no restore lease, so it is safe to
    // run hourly — that is what lets the destructive reset move to midnight
    // without leaving a failed deploy locked out for up to a day.
    const source = readFileSync("convex/crons.ts", "utf8");
    expect(source).toContain('"shared-demo-hourly-provision-heal"');
    expect(source).toContain(
      "sharedDemo.scheduledRestore.runHourlyProvisionHeal",
    );
    expect(source).toContain('"0 * * * *"');
  });
  it("registers the agent harness outbox repair next to its retention and repair sweeps", () => {
    const source = readFileSync("convex/crons.ts", "utf8");
    expect(source).toContain('"agent-harness-retention-sweep"');
    expect(source).toContain('"agent-harness-repair-sweep"');
    expect(source).toContain('"agent-harness-outbox-repair"');
    expect(source).toContain("internal.agentHarness.runtimeHost.repairCompletionOutbox");
  });
  it("registers bounded marketing retention jobs", () => {
    const source = readFileSync("convex/crons.ts", "utf8");
    expect(source).toContain('"walkthrough-retention-cleanup"');
    expect(source).toContain("internal.marketing.walkthroughRequestRetention.cleanupBatch");
    expect(source).toContain('"landing-funnel-retention-cleanup"');
    expect(source).toContain("internal.marketing.landingFunnelRetention.cleanupBatch");
    expect(source).toContain('"walkthrough-notification-recovery"');
    expect(source).toContain("internal.marketing.walkthroughRequestNotifications.scheduleEligibleBatch");
  });
  it("registers POS client-event retention once on the shared cron rail", () => {
    const source = readFileSync("convex/crons.ts", "utf8");
    expect(source.match(/"pos-client-event-retention-cleanup"/g)).toHaveLength(
      1,
    );
    expect(source).toContain("pos.application.clientEventRetention.cleanupBatch");
  });
  it("registers the guarded Daily Operations automation runner", () => {
    const source = readFileSync("convex/crons.ts", "utf8");

    expect(source).toContain('"daily-operations-automation"');
    expect(source).toContain(
      "internal.operations.dailyOperationsAutomation.runConfiguredDailyOperationsAutomation",
    );
    expect(source).toContain('if (process.env.STAGE == "prod")');
    expect(source).toContain("crons.hourly(");
    expect(source).toContain("{ minuteUTC: 0 }");
    expect(source).toContain("crons.cron(");
    expect(source).toContain('"0 */2 * * *"');
    expect(source).not.toContain(
      "internal.operations.dailyOperationsAutomation.runScheduledDailyOperationsAutomation",
    );
  });

  it("registers the report verification sweep on an offset hourly cadence", () => {
    const source = readFileSync("convex/crons.ts", "utf8");

    expect(source).toContain('"report-verification-sweep"');
    expect(source).toContain(
      "internal.reports.verificationSweep.runVerificationSweep",
    );
    // Prod: hourly at :47 — off the 5-minute grid the reports and
    // notifications sweeps occupy, and clear of :00 / :30.
    expect(source).toContain("{ minuteUTC: 47 }");
    // Non-prod: much slower, same offset minute.
    expect(source).toContain('"47 */6 * * *"');
  });

  it("derives the registered cadences from the sweep's tick constants", () => {
    // The rotation advances exactly ONE store index per tick, so its coverage
    // bound (ceil(N / 8) ticks) and its freedom from block starvation both rest
    // on `verificationTickIntervalMs()` matching the cadence Convex actually
    // fires at. The sweep's own tests step by that same function, so they are
    // self-consistent for ANY constant value and cannot catch drift; this is
    // the assertion that can. Both expectations below are built FROM the
    // constants, so a constant that drifts from crons.ts fails here.
    const source = readFileSync("convex/crons.ts", "utf8");

    // Prod registers via `crons.hourly`, which is 60 minutes by definition.
    expect(VERIFICATION_TICK_MINUTES_PROD).toBe(60);
    expect(source).toContain("crons.hourly(");

    // Non-prod registers a raw cron expression; its hour step must be the
    // non-prod constant expressed in hours (and it must divide evenly, or the
    // constant cannot be a cron cadence at all).
    expect(VERIFICATION_TICK_MINUTES_NON_PROD % 60).toBe(0);
    expect(source).toContain(
      `"47 */${VERIFICATION_TICK_MINUTES_NON_PROD / 60} * * *"`,
    );
  });

  it("keeps the verification sweep interval constant in step with its cron", () => {
    const source = readFileSync(
      "convex/automation/scheduledRunLedger.ts",
      "utf8",
    );
    // resolveScheduledWindow derives idempotency windows from this number, so
    // it must equal the registered PROD cadence (hourly = 60 minutes).
    expect(source).toContain(
      `"report-verification-sweep": ${VERIFICATION_TICK_MINUTES_PROD}`,
    );
  });
});

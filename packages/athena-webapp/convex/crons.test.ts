import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
  it("registers bounded marketing retention jobs", () => {
    const source = readFileSync("convex/crons.ts", "utf8");
    expect(source).toContain('"walkthrough-retention-cleanup"');
    expect(source).toContain("internal.marketing.walkthroughRequestRetention.cleanupBatch");
    expect(source).toContain('"landing-funnel-retention-cleanup"');
    expect(source).toContain("internal.marketing.landingFunnelRetention.cleanupBatch");
    expect(source).toContain('"walkthrough-notification-recovery"');
    expect(source).toContain("internal.marketing.walkthroughRequestNotifications.scheduleEligibleBatch");
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

  it("keeps the verification sweep interval constant in step with its cron", () => {
    const source = readFileSync(
      "convex/automation/scheduledRunLedger.ts",
      "utf8",
    );
    // resolveScheduledWindow derives idempotency windows from this number, so
    // it must equal the registered PROD cadence (hourly = 60 minutes).
    expect(source).toContain('"report-verification-sweep": 60');
  });
});

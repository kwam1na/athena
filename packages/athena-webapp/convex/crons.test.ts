import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Convex cron registration", () => {
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
});

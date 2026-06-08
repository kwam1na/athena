import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Convex cron registration", () => {
  it("registers the guarded Daily Operations automation runner", () => {
    const source = readFileSync("convex/crons.ts", "utf8");

    expect(source).toContain('"daily-operations-automation"');
    expect(source).toContain(
      "internal.operations.dailyOperationsAutomation.runConfiguredDailyOperationsAutomation",
    );
    expect(source).not.toContain(
      "internal.operations.dailyOperationsAutomation.runScheduledDailyOperationsAutomation",
    );
  });
});

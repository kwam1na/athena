import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "convex");
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "_generated") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") &&
      !/\.test\.|[Tt]estSupport|\.fixture\./.test(entry.name)
      ? [path]
      : [];
  });
}
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("accepted proof source writer coverage", () => {
  it("keeps every schedule write classified as semantic, irrelevant, or generic restore", () => {
    const writes = sources(root)
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const table = /const entity = ["']storeSchedule["']/.test(source)
          ? `(?:["']storeSchedule["']|entity)`
          : `["']storeSchedule["']`;
        const matches =
          source.match(
            new RegExp(
              `\\.\\s*(?:insert|patch|replace|delete)\\s*\\(\\s*${table}`,
              "g",
            ),
          ) ?? [];
        return matches.map(() => relative(root, path));
      })
      .sort();
    expect(writes).toEqual([
      "inventory/storeSchedule.ts",
      "inventory/storeSchedule.ts",
      "migrations/backfillReportingCycleStart.ts",
      "migrations/backfillStoreSchedules.ts",
      "migrations/backfillStoreTimezoneAuthority.ts",
      "sharedDemo/registerBaseline.ts",
      "sharedDemo/registerBaseline.ts",
      "storeTime/ensureTimezoneAuthority.ts",
      "storeTime/ensureTimezoneAuthority.ts",
    ]);
    for (const path of [
      "inventory/storeSchedule.ts",
      "sharedDemo/registerBaseline.ts",
    ])
      expect(read(path)).toMatch(/bumpAcceptedWatermarkWithCtx\s*\(/);
    expect(read("inventory/storeSchedule.ts")).toMatch(/markWeekDirty\s*\(/);
    expect(read("sharedDemo/registerBaseline.ts")).toMatch(
      /acceptedScheduleProofChanged\s*\(/,
    );

    // These migrations do not alter the frozen resolver's semantic input:
    // absent cycle anchor already means Monday; candidates are excluded; the
    // separate timezone-version link is not schedule.timezone authority.
    expect(read("migrations/backfillReportingCycleStart.ts")).toMatch(
      /patch\("storeSchedule", schedule\._id, \{\s*reportingCycleStartsOn: 1,?\s*\}\)/,
    );
    expect(read("migrations/backfillStoreSchedules.ts")).toContain(
      'status: "candidate"',
    );
    for (const path of [
      "migrations/backfillStoreTimezoneAuthority.ts",
      "storeTime/ensureTimezoneAuthority.ts",
    ])
      expect(
        read(path)
          .match(/patch\("storeSchedule",[^,]+,\s*\{[^}]+\}/g)
          ?.every((write) =>
            /^patch\("storeSchedule",[^,]+,\s*\{\s*timezoneVersionId(?:: [^,}]+)?,?\s*\}$/.test(
              write,
            ),
          ),
      ).toBe(true);
  });

  it("keeps baseline insertion and the set-once correction on the accepted watermark", () => {
    expect(read("reports/weekly.ts")).toMatch(
      /bumpAcceptedWatermarkWithCtx\s*\(/,
    );
    expect(
      /if \(outcome\.outcome === "applied"\)[\s\S]*bumpAcceptedWatermarkWithCtx\s*\(/.test(
        read("reports/weeklyAcceptedRepair.ts"),
      ),
    ).toBe(true);
  });
});

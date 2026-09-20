import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

for (const args of [[], ["not-json", "{}"]]) {
  test(`local health CLI refuses malformed input with a typed blocker: ${JSON.stringify(args)}`, () => {
    const result = spawnSync(
      "bun",
      ["scripts/harness-validation-local-health-check.ts", ...args],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    const failure = JSON.parse(result.stderr);
    expect(failure.schemaVersion).toBe(1);
    expect(failure.blockers).toHaveLength(1);
    expect(failure.blockers[0].code).toBe("local_validation_health_failed");
    expect(failure.blockers[0].source).toEqual({
      kind: "command",
      id: "harness:local-health",
    });
    expect(failure.blockers[0].remediations[0].kind).toBe("manual_action");
  });
}

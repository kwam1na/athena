import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  ATHENA_PREPARATION_SENSOR,
  ATHENA_PREPARATION_AUTHORITY_PATHS,
  checkAthenaPreparationAuthority,
  runAthenaPreparationSensor,
  validateAthenaPreparationSensor,
} from "./athena-preparation-sensor.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");

describe("Athena preparation sensor", () => {
  test("binds the existing preparation authority without claiming the aggregate", () => {
    expect(ATHENA_PREPARATION_SENSOR).toEqual({
      spec: "athena-preparation-sensor/1",
      capabilityId: "sensor.harness-admission",
      command: ["bun", "run", "pr:athena:prepare"],
      trustedBasePath: "scripts/athena-preparation-sensor.mjs",
    });
    expect(validateAthenaPreparationSensor(rootDir, ATHENA_PREPARATION_SENSOR)).toEqual([]);
  });

  test("rejects malformed or missing authority descriptors before invoking preparation", () => {
    expect(
      validateAthenaPreparationSensor(rootDir, {
        ...ATHENA_PREPARATION_SENSOR,
        trustedBasePath: "scripts/not-present.mjs",
      }),
    ).not.toEqual([]);
    expect(
      validateAthenaPreparationSensor(rootDir, {
        ...ATHENA_PREPARATION_SENSOR,
        command: ["bun", "run", "pr:athena"],
      }),
    ).not.toEqual([]);
  });

  test("propagates the preparation authority exit result", async () => {
    const invoked: string[] = [];
    const result = await runAthenaPreparationSensor(rootDir, {
      checkAuthority: async () => true,
      invoke: async (command, cwd) => {
        invoked.push(...command, cwd);
        return 17;
      },
    });

    expect(invoked).toEqual(["bun", "run", "pr:athena:prepare", rootDir]);
    expect(result).toBe(17);
  });

  test("rejects a candidate rewrite of the preparation authority before invoking Bun", async () => {
    const gitCommands: string[][] = [];
    const current = await checkAthenaPreparationAuthority(rootDir, {
      runGit: async (command) => {
        gitCommands.push([...command]);
        return 1;
      },
    });
    expect(current).toBe(false);
    expect(gitCommands).toEqual([
      ["git", "diff", "--quiet", "origin/main", "--", ...ATHENA_PREPARATION_AUTHORITY_PATHS],
    ]);

    let invoked = false;
    const result = await runAthenaPreparationSensor(rootDir, {
      checkAuthority: async () => false,
      invoke: async () => {
        invoked = true;
        return 0;
      },
    });
    expect(result).toBe(1);
    expect(invoked).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
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
      checkCandidateClean: async () => true,
      invoke: async (command, cwd) => {
        invoked.push(...command, cwd);
        return 17;
      },
    });

    expect(invoked).toEqual(["bun", "run", "pr:athena:prepare", rootDir]);
    expect(result).toBe(17);
  });

  test("routes successful preparation repairs back to remediation", async () => {
    let cleanlinessChecked = false;
    const result = await runAthenaPreparationSensor(rootDir, {
      checkAuthority: async () => true,
      invoke: async () => 0,
      checkCandidateClean: async () => {
        cleanlinessChecked = true;
        return false;
      },
    });

    expect(cleanlinessChecked).toBe(true);
    expect(result).toBe(1);
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

  test("rejects a rewrite of a transitive preparation module", async () => {
    const candidateRoot = mkdtempSync(path.join(os.tmpdir(), "athena-preparation-sensor-"));
    try {
      mkdirSync(path.join(candidateRoot, "scripts"));
      writeFileSync(path.join(candidateRoot, "package.json"), "{}\n");
      writeFileSync(path.join(candidateRoot, "scripts", "harness-review.ts"), "export const value = 1;\n");
      execFileSync("git", ["init", "--initial-branch=main"], { cwd: candidateRoot });
      execFileSync("git", ["config", "user.email", "sensor@example.invalid"], {
        cwd: candidateRoot,
      });
      execFileSync("git", ["config", "user.name", "Sensor Test"], { cwd: candidateRoot });
      execFileSync("git", ["add", "."], { cwd: candidateRoot });
      execFileSync("git", ["commit", "-m", "baseline"], { cwd: candidateRoot });
      execFileSync("git", ["remote", "add", "origin", candidateRoot], { cwd: candidateRoot });
      execFileSync("git", ["fetch", "origin", "main:refs/remotes/origin/main"], {
        cwd: candidateRoot,
      });

      writeFileSync(path.join(candidateRoot, "scripts", "harness-review.ts"), "export const value = 2;\n");

      expect(await checkAthenaPreparationAuthority(candidateRoot)).toBe(false);
    } finally {
      rmSync(candidateRoot, { recursive: true, force: true });
    }
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessConfig } from "../.agent-skills/current/runtime/kernel.mjs";
import type { ValidationPlanMode } from "./harness-validation-plan.ts";
import type { projectCapturedValidationPlan } from "./harness-validation-capture.ts";

export type NativeValidationSelection = ReturnType<
  typeof projectCapturedValidationPlan
>;

/** Node's native config loader delegates only repository analysis to Bun. This
 * child never executes checks, consumes uploaded plans, or emits native evidence. */
export function captureNativeValidationSelection(
  rootDir: string,
  config: HarnessConfig,
  mode: ValidationPlanMode,
): NativeValidationSelection {
  const temp = mkdtempSync(join(tmpdir(), "athena-validation-selection-"));
  try {
    const configPath = join(temp, "config.json");
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    const output = execFileSync(
      "bun",
      [
        join(import.meta.dirname, "harness-validation-plan.ts"),
        "--capture-config",
        configPath,
        "--mode",
        mode,
      ],
      {
        cwd: rootDir,
        // Planning is source-only. Do not forward controller credentials or runtime
        // preload options into the analysis process.
        env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: temp },
        timeout: 600000,
        maxBuffer: 128 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(output),
    );
    if (
      parsed?.schemaVersion !== "athena-native-selection/1" ||
      parsed.plan?.mode !== mode ||
      parsed.plan?.evidence !== "not-evaluated" ||
      !Array.isArray(parsed.plan?.checks) ||
      !parsed.plan.checks.length ||
      !Array.isArray(parsed.inventory) ||
      !parsed.candidate?.treeSha ||
      typeof parsed.packageScripts !== "object" ||
      parsed.packageScripts === null ||
      "snapshots" in parsed
    )
      throw new Error(
        "Native planning child returned an invalid selection projection",
      );
    return parsed as NativeValidationSelection;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

import { spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The trusted base copied verbatim into the facade's model-external sensor. */
export const ATHENA_PREPARATION_SENSOR = Object.freeze({
  spec: "athena-preparation-sensor/1",
  capabilityId: "sensor.harness-admission",
  command: ["bun", "run", "pr:athena:prepare"],
  trustedBasePath: "scripts/athena-preparation-sensor.mjs",
});

/** The authority inputs pr:athena:prepare itself reads; candidates may not rewrite them mid-run. */
export const ATHENA_PREPARATION_AUTHORITY_PATHS = Object.freeze([
  "package.json",
  "scripts/pr-athena-prepare.ts",
  "scripts/harness-candidate.ts",
  "scripts/bun-version-check.ts",
  "scripts/frontend-dependency-parity.ts",
  "scripts/pre-commit-generated-artifacts.ts",
  "scripts/pre-push-validation-proof.ts",
  "scripts/harness-mechanical-check.ts",
  "scripts/harness-blockers.ts",
]);

function isDescriptor(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (
    value.spec === ATHENA_PREPARATION_SENSOR.spec &&
    value.capabilityId === ATHENA_PREPARATION_SENSOR.capabilityId &&
    Array.isArray(value.command) &&
    value.command.every((part) => typeof part === "string") &&
    value.trustedBasePath === ATHENA_PREPARATION_SENSOR.trustedBasePath
  );
}

/** Read-only descriptor/path validation before this sensor can invoke preparation. */
export function validateAthenaPreparationSensor(rootDir, descriptor) {
  if (!isDescriptor(descriptor)) return ["the preparation sensor descriptor is malformed"];
  if (
    descriptor.command.length !== ATHENA_PREPARATION_SENSOR.command.length ||
    descriptor.command.some((part, index) => part !== ATHENA_PREPARATION_SENSOR.command[index])
  ) {
    return ["the preparation sensor command is not bun run pr:athena:prepare"];
  }

  const trustedBasePath = path.resolve(rootDir, descriptor.trustedBasePath);
  const expectedPath = path.resolve(rootDir, ATHENA_PREPARATION_SENSOR.trustedBasePath);
  if (trustedBasePath !== expectedPath) {
    return ["the preparation sensor path is not the fixed trusted base"];
  }
  try {
    const metadata = lstatSync(trustedBasePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return ["the preparation sensor path is not a direct regular file"];
    }
  } catch {
    return ["the preparation sensor path is missing"];
  }
  return [];
}

function invokePreparation(command, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

/** Returns false when the candidate has changed its own preparation authority. */
export async function checkAthenaPreparationAuthority(rootDir, options = {}) {
  const runGit = options.runGit ?? ((command, cwd) => invokePreparation(command, cwd));
  return (
    (await runGit(
      ["git", "diff", "--quiet", "origin/main", "--", ...ATHENA_PREPARATION_AUTHORITY_PATHS],
      rootDir,
    )) === 0
  );
}

/** Invokes Athena's existing preparation authority and returns its exact exit code. */
export async function runAthenaPreparationSensor(rootDir, options = {}) {
  const defects = validateAthenaPreparationSensor(rootDir, ATHENA_PREPARATION_SENSOR);
  if (defects.length > 0) throw new Error(defects.join("; "));
  const authorityCurrent = await (options.checkAuthority ?? checkAthenaPreparationAuthority)(rootDir);
  if (!authorityCurrent) return 1;
  return (options.invoke ?? invokePreparation)(ATHENA_PREPARATION_SENSOR.command, rootDir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runAthenaPreparationSensor(process.cwd());
}

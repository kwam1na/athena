import { readdir } from "node:fs/promises";
import path from "node:path";

const ROOT_TEST_DIRECTORY = "scripts";
const TEST_FILE_SUFFIX = ".test.ts";

type SpawnedProcess = {
  exited: Promise<number>;
};

type HarnessTestOptions = {
  spawn?: (
    command: string[],
    options: { cwd: string; stdout: "inherit"; stderr: "inherit" }
  ) => SpawnedProcess;
  passthroughArgs?: string[];
  dryRun?: boolean;
  logger?: Pick<Console, "log">;
};

type HarnessTestCliArgs = {
  dryRun: boolean;
  passthroughArgs: string[];
};

export async function collectHarnessTestTargets(rootDir: string) {
  const scriptsDir = path.join(rootDir, ROOT_TEST_DIRECTORY);
  const entries = await readdir(scriptsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(TEST_FILE_SUFFIX))
    .map((entry) => path.join(scriptsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export async function runHarnessTest(
  rootDir: string,
  options: HarnessTestOptions = {}
) {
  const spawn = options.spawn ?? Bun.spawn;
  const passthroughArgs = options.passthroughArgs ?? Bun.argv.slice(2);
  const dryRun = options.dryRun ?? false;
  const logger = options.logger ?? console;
  const targets = await collectHarnessTestTargets(rootDir);

  if (targets.length === 0) {
    throw new Error(
      `[harness:test] No ${ROOT_TEST_DIRECTORY}/*${TEST_FILE_SUFFIX} files found at repo root.`
    );
  }

  if (dryRun) {
    logger.log("[harness:test] Selected repo-root script tests:");
    for (const target of targets) {
      logger.log(target);
    }
    return;
  }

  const proc = spawn(["bun", "test", ...targets, ...passthroughArgs], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`[harness:test] bun test failed (exit ${exitCode}).`);
  }
}

export function parseHarnessTestCliArgs(args: string[]): HarnessTestCliArgs {
  const passthroughArgs: string[] = [];
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    passthroughArgs.push(arg);
  }

  return {
    dryRun,
    passthroughArgs,
  };
}

if (import.meta.main) {
  const args = parseHarnessTestCliArgs(Bun.argv.slice(2));

  runHarnessTest(process.cwd(), args).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

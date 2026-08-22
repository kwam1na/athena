import { readdir } from "node:fs/promises";
import path from "node:path";

import { withoutGitRepositoryContext } from "./git-environment";
import {
  HarnessBlockedError,
  createHarnessBlocker,
  runHarnessCliBoundary,
} from "./harness-blockers";

const ROOT_TEST_DIRECTORY = "scripts";
const TEST_FILE_SUFFIX = ".test.ts";

type SpawnedProcess = {
  exited: Promise<number>;
};

type HarnessTestOptions = {
  spawn?: (
    command: string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      stdout: "inherit";
      stderr: "inherit";
    }
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
    env: withoutGitRepositoryContext(),
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    // A failing test is the ordinary outcome this command exists to report.
    // Thrown bare, it reached the CLI boundary as an unexpected exception and
    // rendered as `harness_internal_error` with a stack.
    throw new HarnessBlockedError(
      [harnessTestsFailedBlocker(exitCode)],
      `[harness:test] bun test failed (exit ${exitCode}).`,
    );
  }
}

/**
 * A failing test is the ordinary outcome this command exists to report.
 * Thrown bare, it reached the CLI boundary as an unexpected exception and
 * rendered as `harness_internal_error` with a stack.
 */
export function harnessTestsFailedBlocker(exitCode: number) {
  return createHarnessBlocker({
    code: "harness_tests_failed",
    source: { kind: "command", id: "harness:test" },
    summary: `Harness tests failed (exit ${exitCode}).`,
    details:
      "The failing test output is printed above; this command streams the runner's own output.",
    remediations: [
      {
        id: "fix-failing-harness-tests",
        kind: "code_change",
        summary: "Fix the failing tests or the behavior they cover, then rerun.",
      },
      {
        id: "rerun-harness-tests",
        kind: "command",
        command: ["bun", "run", "harness:test"],
        summary: "Rerun the harness test suite.",
      },
    ],
  });
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
  process.exitCode = await runHarnessCliBoundary({
    source: { kind: "command", id: "harness:test" },
    reproduce: ["bun", "run", "harness:test", ...Bun.argv.slice(2)],
    run: () => {
      const args = parseHarnessTestCliArgs(Bun.argv.slice(2));
      return runHarnessTest(process.cwd(), args);
    },
  });
}

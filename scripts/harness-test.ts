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
  selectedFiles?: string[];
  spawn?: (
    command: string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      stdout: "inherit";
      stderr: "inherit";
    },
  ) => SpawnedProcess;
  passthroughArgs?: string[];
  dryRun?: boolean;
  logger?: Pick<Console, "log">;
};

type HarnessTestCliArgs = {
  selectedFiles?: string[];
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
  options: HarnessTestOptions = {},
) {
  const spawn = options.spawn ?? Bun.spawn;
  const passthroughArgs =
    options.passthroughArgs ??
    (options.selectedFiles === undefined ? Bun.argv.slice(2) : []);
  const dryRun = options.dryRun ?? false;
  const logger = options.logger ?? console;
  const inventory = await collectHarnessTestTargets(rootDir);
  const targets =
    options.selectedFiles === undefined
      ? inventory
      : selectHarnessTestTargets(rootDir, inventory, options.selectedFiles);
  if (options.selectedFiles !== undefined)
    validateSelectedRunnerArgs(passthroughArgs);

  if (targets.length === 0) {
    throw new Error(
      `[harness:test] No ${ROOT_TEST_DIRECTORY}/*${TEST_FILE_SUFFIX} files found at repo root.`,
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

function invalidSelection(details: string): HarnessBlockedError {
  return new HarnessBlockedError([
    createHarnessBlocker({
      code: "harness_test_selection_invalid",
      source: { kind: "command", id: "harness:test" },
      summary: "Explicit harness test membership is invalid.",
      details,
      remediations: [
        {
          id: "correct-harness-test-membership",
          kind: "code_change",
          summary:
            "Select a nonempty list of existing direct scripts/*.test.ts files from the validation plan.",
        },
      ],
    }),
  ]);
}

function selectHarnessTestTargets(
  rootDir: string,
  inventory: string[],
  selectedFiles: string[],
): string[] {
  if (selectedFiles.length === 0)
    throw invalidSelection("The explicit selection is empty.");
  const available = new Set(inventory);
  const selected = new Set<string>();
  for (const file of selectedFiles) {
    const absolute = path.resolve(rootDir, file);
    if (
      !/^scripts\/[^/\\]+\.test\.ts$/.test(file) ||
      !available.has(absolute)
    ) {
      throw invalidSelection(`Not a direct regular root test file: ${file}`);
    }
    selected.add(absolute);
  }
  return [...selected].sort((left, right) => left.localeCompare(right));
}

/** Selected execution accepts only options that preserve the declared file set. */
function validateSelectedRunnerArgs(args: string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--timeout") {
      throw invalidSelection(
        "Explicit membership supports only --timeout <milliseconds> after --; additional runner selectors could change the declared test set.",
      );
    }
    const timeout = args[++index];
    if (
      !timeout ||
      !/^[1-9][0-9]*$/.test(timeout) ||
      !Number.isSafeInteger(Number(timeout))
    ) {
      throw invalidSelection(
        "--timeout requires a positive integer number of milliseconds.",
      );
    }
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
        summary:
          "Fix the failing tests or the behavior they cover, then rerun.",
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
  let selectedFiles: string[] | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      passthroughArgs.push(...args.slice(index + 1));
      break;
    }
    if (arg === "--test-file") {
      const file = args[++index];
      if (!file || file.startsWith("--"))
        throw invalidSelection(
          "--test-file requires a repository-relative test path.",
        );
      (selectedFiles ??= []).push(file);
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    passthroughArgs.push(arg);
  }

  return {
    ...(selectedFiles === undefined ? {} : { selectedFiles }),
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

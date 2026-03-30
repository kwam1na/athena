import { resolve } from "node:path";
import { toErrorMessage } from "./errors";
import { createSymphonyService, type CreateSymphonyServiceOptions, type SymphonyService } from "./service";
import { DEFAULT_WORKFLOW_FILE } from "./workflow";

interface CliOptions {
  workflowPath: string;
  watch: boolean;
  printEffectiveConfig: boolean;
}

interface CliDependencies {
  cwd: () => string;
  createService: (options: CreateSymphonyServiceOptions) => SymphonyService;
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
  onUncaughtException: (handler: (error: unknown) => void) => void;
  onUnhandledRejection: (handler: (reason: unknown) => void) => void;
  writeStderr: (line: string) => void;
  exit: (code: number) => void;
}

const defaultCliDependencies: CliDependencies = {
  cwd: () => process.cwd(),
  createService: (options) => createSymphonyService(options),
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  onUncaughtException: (handler) => {
    process.on("uncaughtException", handler);
  },
  onUnhandledRejection: (handler) => {
    process.on("unhandledRejection", handler);
  },
  writeStderr: (line) => {
    process.stderr.write(line);
  },
  exit: (code) => {
    process.exit(code);
  },
};

export function parseCliArgs(args: string[], cwd: string): CliOptions {
  let workflowPath = DEFAULT_WORKFLOW_FILE;
  let watch = false;
  let printEffectiveConfig = false;

  for (const arg of args) {
    if (arg === "--watch") {
      watch = true;
      continue;
    }

    if (arg === "--print-effective-config") {
      printEffectiveConfig = true;
      continue;
    }

    if (!arg.startsWith("-")) {
      workflowPath = arg;
    }
  }

  return {
    workflowPath: resolve(cwd, workflowPath),
    watch,
    printEffectiveConfig,
  };
}

export async function runCli(
  args: string[],
  dependencies: CliDependencies = defaultCliDependencies,
): Promise<void> {
  const options = parseCliArgs(args, dependencies.cwd());
  const service = dependencies.createService({
    workflowPath: options.workflowPath,
    watch: options.watch,
    printEffectiveConfig: options.printEffectiveConfig,
  });

  await service.start();

  let shuttingDown = false;

  const stop = (exitCode: number, error?: unknown) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (error !== undefined) {
      dependencies.writeStderr(`[symphony] fatal host error: ${toErrorMessage(error)}\n`);
    }

    void service
      .stop()
      .catch((error) => {
        dependencies.writeStderr(`[symphony] shutdown failed: ${toErrorMessage(error)}\n`);
      })
      .finally(() => {
        dependencies.exit(exitCode);
      });
  };

  dependencies.onSignal("SIGINT", () => stop(0));
  dependencies.onSignal("SIGTERM", () => stop(0));
  dependencies.onUncaughtException((error) => stop(1, error));
  dependencies.onUnhandledRejection((reason) => stop(1, reason));
}

export async function runCliEntry(
  args: string[],
  dependencies: CliDependencies = defaultCliDependencies,
): Promise<void> {
  try {
    await runCli(args, dependencies);
  } catch (error) {
    dependencies.writeStderr(`[symphony] startup failed: ${toErrorMessage(error)}\n`);
    dependencies.exit(1);
  }
}

if (import.meta.main) {
  void runCliEntry(process.argv.slice(2));
}

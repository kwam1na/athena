import { resolve } from "node:path";
import { toErrorMessage } from "./errors";
import { startStatusServer, type StatusServer } from "./httpServer";
import { createSymphonyService, type CreateSymphonyServiceOptions, type SymphonyService } from "./service";
import { DEFAULT_WORKFLOW_FILE, loadWorkflowFile } from "./workflow";

interface CliOptions {
  workflowPath: string;
  watch: boolean;
  printEffectiveConfig: boolean;
  port?: number;
}

interface CliDependencies {
  cwd: () => string;
  createService: (options: CreateSymphonyServiceOptions) => SymphonyService;
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
  onUncaughtException: (handler: (error: unknown) => void) => void;
  onUnhandledRejection: (handler: (reason: unknown) => void) => void;
  resolveWorkflowServerPort: (workflowPath: string) => Promise<number | undefined>;
  startStatusServer: (input: { service: SymphonyService; port: number }) => Promise<StatusServer>;
  writeStderr: (line: string) => void;
  writeStdout: (line: string) => void;
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
  resolveWorkflowServerPort: async (workflowPath) => {
    const workflow = await loadWorkflowFile(workflowPath);
    return parseWorkflowServerPort(workflow.config);
  },
  startStatusServer: async (input) => {
    return await startStatusServer({
      service: input.service,
      port: input.port,
    });
  },
  writeStderr: (line) => {
    process.stderr.write(line);
  },
  writeStdout: (line) => {
    process.stdout.write(line);
  },
  exit: (code) => {
    process.exit(code);
  },
};

export function parseCliArgs(args: string[], cwd: string): CliOptions {
  let workflowPath = DEFAULT_WORKFLOW_FILE;
  let watch = false;
  let printEffectiveConfig = false;
  let port: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--watch") {
      watch = true;
      continue;
    }

    if (arg === "--print-effective-config") {
      printEffectiveConfig = true;
      continue;
    }

    if (arg === "--port") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("missing value for --port");
      }
      port = parsePortArg(value);
      i += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      port = parsePortArg(arg.slice("--port=".length));
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
    port,
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

  let statusServer: StatusServer | null = null;
  try {
    const configuredPort = options.port ?? (await dependencies.resolveWorkflowServerPort(options.workflowPath));
    if (typeof configuredPort === "number") {
      statusServer = await dependencies.startStatusServer({
        service,
        port: configuredPort,
      });
      dependencies.writeStdout(`[symphony] status server listening on http://${statusServer.host}:${statusServer.port}\n`);
    }
  } catch (error) {
    try {
      await service.stop();
    } catch (stopError) {
      dependencies.writeStderr(`[symphony] shutdown failed: ${toErrorMessage(stopError)}\n`);
    }
    throw error;
  }

  let shuttingDown = false;

  const stop = (exitCode: number, error?: unknown) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (error !== undefined) {
      dependencies.writeStderr(`[symphony] fatal host error: ${toErrorMessage(error)}\n`);
    }

    void (async () => {
      if (statusServer) {
        try {
          await statusServer.stop();
        } catch (statusServerError) {
          dependencies.writeStderr(`[symphony] status server shutdown failed: ${toErrorMessage(statusServerError)}\n`);
        }
      }

      try {
        await service.stop();
      } catch (serviceStopError) {
        dependencies.writeStderr(`[symphony] shutdown failed: ${toErrorMessage(serviceStopError)}\n`);
      }
    })()
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

function parsePortArg(rawValue: string): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== rawValue.trim()) {
    throw new Error(`invalid --port value: ${rawValue}`);
  }

  if (parsed < 0 || parsed > 65535) {
    throw new Error(`--port out of range: ${rawValue}`);
  }

  return parsed;
}

function parseWorkflowServerPort(config: Record<string, unknown>): number | undefined {
  const server = asObject(config.server);
  if (!server || !Object.prototype.hasOwnProperty.call(server, "port")) {
    return undefined;
  }

  const portValue = server.port;
  if (typeof portValue === "number" && Number.isInteger(portValue) && portValue >= 0 && portValue <= 65535) {
    return portValue;
  }

  if (typeof portValue === "string") {
    return parsePortArg(portValue);
  }

  throw new Error("invalid server.port in workflow config");
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

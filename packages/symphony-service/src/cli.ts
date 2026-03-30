import { resolve } from "node:path";
import { toErrorMessage } from "./errors";
import { createSymphonyService } from "./service";
import { DEFAULT_WORKFLOW_FILE } from "./workflow";

interface CliOptions {
  workflowPath: string;
  watch: boolean;
  printEffectiveConfig: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const service = createSymphonyService({
    workflowPath: options.workflowPath,
    watch: options.watch,
    printEffectiveConfig: options.printEffectiveConfig,
  });

  await service.start();

  const stop = () => {
    void service
      .stop()
      .catch((error) => {
        process.stderr.write(`[symphony] shutdown failed: ${toErrorMessage(error)}\n`);
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function parseArgs(args: string[]): CliOptions {
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
    workflowPath: resolve(process.cwd(), workflowPath),
    watch,
    printEffectiveConfig,
  };
}

main().catch((error) => {
  process.stderr.write(`[symphony] startup failed: ${toErrorMessage(error)}\n`);
  process.exit(1);
});

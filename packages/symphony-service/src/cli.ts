import { resolve } from "node:path";
import { resolveEffectiveConfig } from "./config";
import { toErrorMessage } from "./errors";
import { validateDispatchPreflight } from "./validate";
import { DEFAULT_WORKFLOW_FILE, loadWorkflowFile, watchWorkflowFile } from "./workflow";

interface CliOptions {
  workflowPath: string;
  watch: boolean;
  printEffectiveConfig: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  let lastGood = await loadAndValidate(options.workflowPath, options.printEffectiveConfig);

  if (!options.watch) {
    return;
  }

  process.stdout.write(`[symphony] watching ${lastGood.workflow.path}\n`);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const watcher = watchWorkflowFile(lastGood.workflow.path, () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(async () => {
      try {
        lastGood = await loadAndValidate(options.workflowPath, options.printEffectiveConfig);
        process.stdout.write(`[symphony] reloaded ${lastGood.workflow.path}\n`);
      } catch (error) {
        process.stderr.write(`[symphony] reload failed (keeping last-known-good): ${toErrorMessage(error)}\n`);
      }
    }, 100);
  });

  const stop = () => {
    watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function loadAndValidate(workflowPath: string, printConfig: boolean) {
  const workflow = await loadWorkflowFile(workflowPath);
  const config = resolveEffectiveConfig(workflow.config);
  validateDispatchPreflight(config);

  process.stdout.write(`[symphony] config valid: tracker=${config.tracker.kind} project=${config.tracker.projectSlug} poll=${config.polling.intervalMs}ms\n`);

  if (printConfig) {
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
  }

  return { workflow, config };
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

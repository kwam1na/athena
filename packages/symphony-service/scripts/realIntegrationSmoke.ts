import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveEffectiveConfig } from "../src/config";
import { LinearTrackerClient } from "../src/tracker/linear";
import { validateDispatchPreflight } from "../src/validate";
import { loadWorkflowFile } from "../src/workflow";

async function main(): Promise<void> {
  const { workflowPath, runLinearSmoke, runCodexSmoke } = parseArgs(process.argv.slice(2));

  const workflow = await loadWorkflowFile(workflowPath);
  const config = resolveEffectiveConfig(workflow.config);
  validateDispatchPreflight(config);

  console.log(`[integration] workflow=${workflow.path}`);
  console.log(`[integration] tracker_kind=${config.tracker.kind}`);
  console.log(`[integration] linear_smoke=${String(runLinearSmoke)} codex_smoke=${String(runCodexSmoke)}`);

  if (runLinearSmoke) {
    if (config.tracker.kind !== "linear") {
      throw new Error(`real integration smoke only supports tracker.kind=linear (received: ${config.tracker.kind})`);
    }

    const tracker = new LinearTrackerClient({
      endpoint: config.tracker.endpoint,
      apiKey: config.tracker.apiKey ?? "",
      projectSlug: config.tracker.projectSlug ?? "",
      activeStates: config.tracker.activeStates,
    });

    const candidates = await tracker.fetchCandidateIssues();
    console.log(`[integration] linear_candidate_count=${candidates.length}`);
  }

  if (runCodexSmoke) {
    await smokeLaunchCodex(config.codex.command, dirname(workflow.path));
    console.log("[integration] codex_launch=ok");
  }

  console.log("[integration] status=ok");
}

function parseArgs(args: string[]): {
  workflowPath: string;
  runLinearSmoke: boolean;
  runCodexSmoke: boolean;
} {
  let workflowPath: string | null = null;
  let runLinearSmoke = true;
  let runCodexSmoke = true;

  for (const arg of args) {
    if (arg.startsWith("--linear=")) {
      runLinearSmoke = parseBooleanFlag("linear", arg.slice("--linear=".length));
      continue;
    }

    if (arg.startsWith("--codex=")) {
      runCodexSmoke = parseBooleanFlag("codex", arg.slice("--codex=".length));
      continue;
    }

    if (!arg.startsWith("-")) {
      workflowPath = arg;
    }
  }

  return {
    workflowPath: resolveWorkflowPath(workflowPath),
    runLinearSmoke,
    runCodexSmoke,
  };
}

function resolveWorkflowPath(rawPath: string | null): string {
  const candidates = rawPath
    ? [resolve(process.cwd(), rawPath), resolve(process.cwd(), "../../", rawPath)]
    : [resolve(process.cwd(), "../../WORKFLOW.md"), resolve(process.cwd(), "WORKFLOW.md")];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function parseBooleanFlag(name: string, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  throw new Error(`invalid --${name} value: ${value}`);
}

async function smokeLaunchCodex(command: string, cwd: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const processHandle = spawn("bash", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let stderr = "";
    const killTimer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      processHandle.kill("SIGTERM");
      setTimeout(() => {
        processHandle.kill("SIGKILL");
      }, 500).unref();
      resolvePromise();
    }, 1500);

    processHandle.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > 8_000) {
        stderr = stderr.slice(-8_000);
      }
    });

    processHandle.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(killTimer);
      rejectPromise(new Error(`failed to launch codex command: ${error.message}`));
    });

    processHandle.on("exit", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(killTimer);

      if (signal === "SIGTERM" || signal === "SIGKILL") {
        resolvePromise();
        return;
      }

      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `codex command exited before smoke timeout (code=${String(code)} signal=${String(signal)} stderr=${stderr.trim()})`,
        ),
      );
    });
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[integration] status=failed error=${message}\n`);
  process.exit(1);
});

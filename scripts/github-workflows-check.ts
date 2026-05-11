import { readdir } from "node:fs/promises";
import path from "node:path";

type SpawnedProcess = {
  exited: Promise<number>;
};

type WorkflowCheckOptions = {
  spawn?: (
    command: string[],
    options: { cwd: string; stdout: "inherit"; stderr: "inherit" }
  ) => SpawnedProcess;
  logger?: Pick<Console, "log">;
};

const WORKFLOW_DIRECTORY = ".github/workflows";
const WORKFLOW_FILE_PATTERN = /\.ya?ml$/i;

export async function collectWorkflowFiles(rootDir: string) {
  const workflowDir = path.join(rootDir, WORKFLOW_DIRECTORY);
  const entries = await readdir(workflowDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && WORKFLOW_FILE_PATTERN.test(entry.name))
    .map((entry) => path.join(WORKFLOW_DIRECTORY, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export async function runWorkflowCheck(
  rootDir: string,
  options: WorkflowCheckOptions = {}
) {
  const workflowFiles = await collectWorkflowFiles(rootDir);
  const spawn = options.spawn ?? Bun.spawn;
  const logger = options.logger ?? console;

  if (workflowFiles.length === 0) {
    throw new Error(`No GitHub workflow YAML files found in ${WORKFLOW_DIRECTORY}.`);
  }

  for (const workflowFile of workflowFiles) {
    const proc = spawn(
      [
        "ruby",
        "-ryaml",
        "-e",
        "YAML.load_file(ARGV.fetch(0)); puts \"[workflow:check] parsed #{ARGV.fetch(0)}\"",
        workflowFile,
      ],
      {
        cwd: rootDir,
        stdout: "inherit",
        stderr: "inherit",
      }
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(
        `GitHub workflow YAML check failed for ${workflowFile} (exit ${exitCode}).`
      );
    }
  }

  logger.log(`GitHub workflow YAML check passed for ${workflowFiles.length} workflow file(s).`);
}

if (import.meta.main) {
  try {
    await runWorkflowCheck(path.resolve(import.meta.dirname, ".."));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

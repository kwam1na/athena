import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import { writeGeneratedHarnessDocs } from "./harness-generate";
import { TRACKED_GRAPHIFY_ARTIFACTS } from "./graphify-check";
import { runGraphifyRebuild } from "./graphify-rebuild";

const TRACKED_GENERATED_HARNESS_DOCS = [
  ...new Set(
    HARNESS_APP_REGISTRY.flatMap((app) => app.harnessDocs.generatedDocs)
  ),
].sort((left, right) => left.localeCompare(right));

type SpawnedProcess = {
  exited: Promise<number>;
  stderr?: ReadableStream | null;
};

type PreCommitGeneratedArtifactsLogger = Pick<Console, "log">;

type PreCommitGeneratedArtifactsOptions = {
  runGraphifyRebuild?: (rootDir: string) => Promise<void>;
  runHarnessGenerate?: (rootDir: string) => Promise<void>;
  spawn?: (
    command: string[],
    options: { cwd: string; stdout: "inherit"; stderr: "pipe" }
  ) => SpawnedProcess;
  logger?: PreCommitGeneratedArtifactsLogger;
};

async function stageTrackedGeneratedArtifacts(
  rootDir: string,
  spawn: NonNullable<PreCommitGeneratedArtifactsOptions["spawn"]>,
  paths: string[],
  label: string
) {
  const command = ["git", "add", "--", ...paths];
  const proc = spawn(command, {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    return;
  }

  const stderr = proc.stderr
    ? (await new Response(proc.stderr).text()).trim()
    : "";
  throw new Error(
    stderr ||
      `Failed to stage tracked ${label} artifacts (exit ${exitCode}): ${command.join(" ")}`
  );
}

export async function runPreCommitGeneratedArtifacts(
  rootDir: string,
  options: PreCommitGeneratedArtifactsOptions = {}
) {
  const logger = options.logger ?? console;
  const rebuild = options.runGraphifyRebuild ?? runGraphifyRebuild;
  const generateHarnessDocs =
    options.runHarnessGenerate ?? writeGeneratedHarnessDocs;
  const spawn =
    options.spawn ??
    ((command, spawnOptions) =>
      Bun.spawn(command, {
        ...spawnOptions,
      }));

  logger.log("[pre-commit] Refreshing generated harness docs...");
  await generateHarnessDocs(rootDir);
  await stageTrackedGeneratedArtifacts(
    rootDir,
    spawn,
    TRACKED_GENERATED_HARNESS_DOCS,
    "harness doc"
  );

  logger.log("[pre-commit] Refreshing tracked graphify artifacts...");
  await rebuild(rootDir);
  await stageTrackedGeneratedArtifacts(
    rootDir,
    spawn,
    TRACKED_GRAPHIFY_ARTIFACTS,
    "graphify"
  );
}

export { TRACKED_GENERATED_HARNESS_DOCS, TRACKED_GRAPHIFY_ARTIFACTS };

if (import.meta.main) {
  runPreCommitGeneratedArtifacts(process.cwd()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[pre-commit] BLOCKED: ${message}`);
    process.exit(1);
  });
}

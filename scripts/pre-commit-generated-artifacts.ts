import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import { writeGeneratedHarnessDocs } from "./harness-generate";
import { TRACKED_GRAPHIFY_ARTIFACTS } from "./graphify-check";
import { runGraphifyRebuild } from "./graphify-rebuild";

const GENERATED_HARNESS_DOC_ARTIFACTS = [
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
  runHarnessGenerate?: (rootDir: string) => Promise<void>;
  runGraphifyRebuild?: (rootDir: string) => Promise<void>;
  spawn?: (
    command: string[],
    options: { cwd: string; stdout: "inherit"; stderr: "pipe" }
  ) => SpawnedProcess;
  logger?: PreCommitGeneratedArtifactsLogger;
};

async function stageGeneratedArtifacts(
  rootDir: string,
  spawn: NonNullable<PreCommitGeneratedArtifactsOptions["spawn"]>,
  artifacts: string[],
  label: string
) {
  const command = ["git", "add", "--", ...artifacts];
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
      `Failed to stage ${label} (exit ${exitCode}): ${command.join(" ")}`
  );
}

export async function runPreCommitGeneratedArtifacts(
  rootDir: string,
  options: PreCommitGeneratedArtifactsOptions = {}
) {
  const logger = options.logger ?? console;
  const generateHarnessDocs =
    options.runHarnessGenerate ?? writeGeneratedHarnessDocs;
  const rebuild = options.runGraphifyRebuild ?? runGraphifyRebuild;
  const spawn =
    options.spawn ??
    ((command, spawnOptions) =>
      Bun.spawn(command, {
        ...spawnOptions,
      }));

  logger.log("[pre-commit] Refreshing generated harness docs...");
  await generateHarnessDocs(rootDir);
  await stageGeneratedArtifacts(
    rootDir,
    spawn,
    GENERATED_HARNESS_DOC_ARTIFACTS,
    "generated harness docs"
  );

  logger.log("[pre-commit] Refreshing tracked graphify artifacts...");
  await rebuild(rootDir);
  await stageGeneratedArtifacts(
    rootDir,
    spawn,
    TRACKED_GRAPHIFY_ARTIFACTS,
    "tracked graphify artifacts"
  );
}

export { GENERATED_HARNESS_DOC_ARTIFACTS, TRACKED_GRAPHIFY_ARTIFACTS };

if (import.meta.main) {
  runPreCommitGeneratedArtifacts(process.cwd()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[pre-commit] BLOCKED: ${message}`);
    process.exit(1);
  });
}

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import { writeGeneratedHarnessDocs } from "./harness-generate";
import { TRACKED_GRAPHIFY_ARTIFACTS } from "./graphify-check";
import { runGraphifyRebuild } from "./graphify-rebuild";

const TRACKED_GENERATED_HARNESS_DOCS = [
  ...new Set(
    HARNESS_APP_REGISTRY.flatMap((app) => app.harnessDocs.generatedDocs)
  ),
].sort((left, right) => left.localeCompare(right));

const TRACKED_CONVEX_GENERATED_ARTIFACTS = [
  path.join("packages", "athena-webapp", "convex", "_generated", "api.d.ts"),
  path.join("packages", "athena-webapp", "convex", "_generated", "api.js"),
  path.join("packages", "athena-webapp", "convex", "_generated", "dataModel.d.ts"),
  path.join("packages", "athena-webapp", "convex", "_generated", "server.d.ts"),
  path.join("packages", "athena-webapp", "convex", "_generated", "server.js"),
].sort((left, right) => left.localeCompare(right));

const HELP_TEXT = `Usage: bun scripts/pre-commit-generated-artifacts.ts [--help]

Refresh and verify tracked generated artifacts that must be committed with source changes:
  - harness docs from the harness registry
  - Convex generated API files under packages/athena-webapp/convex/_generated/
  - graphify artifacts under graphify-out/
  - tracked working-tree changes via git add --update

Run this before committing or as part of the repo pre-push flow when generated
outputs may drift.
`;

const CONVEX_DIR = path.join("packages", "athena-webapp", "convex");
const CONVEX_GENERATED_API_PATH = path.join(
  CONVEX_DIR,
  "_generated",
  "api.d.ts"
);
const CONVEX_API_MODULE_EXCEPTIONS = new Set([
  "auth.config",
  "schema",
  "storeFront/customer",
]);

type SpawnedProcess = {
  exited: Promise<number>;
  stdout?: ReadableStream | null;
  stderr?: ReadableStream | null;
};

type PreCommitGeneratedArtifactsLogger = Pick<Console, "log">;

type PreCommitGeneratedArtifactsOptions = {
  hasConvexSourceChanges?: (rootDir: string) => Promise<boolean>;
  refreshConvexGeneratedApi?: (rootDir: string) => Promise<void>;
  verifyConvexGeneratedApi?: (rootDir: string) => Promise<void>;
  runGraphifyRebuild?: (rootDir: string) => Promise<void>;
  runHarnessGenerate?: (rootDir: string) => Promise<void>;
  spawn?: (
    command: string[],
    options: { cwd: string; stdout: "inherit" | "pipe"; stderr: "pipe" }
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
    stdout: "pipe",
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

async function stageTrackedWorkingTreeChanges(
  rootDir: string,
  spawn: NonNullable<PreCommitGeneratedArtifactsOptions["spawn"]>
) {
  const command = ["git", "add", "--update", "--", "."];
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
      `Failed to stage tracked working-tree changes (exit ${exitCode}): ${command.join(" ")}`
  );
}

async function hasAthenaConvexSourceChanges(
  rootDir: string,
  spawn: NonNullable<PreCommitGeneratedArtifactsOptions["spawn"]>
) {
  const command = ["git", "status", "--porcelain", "--", CONVEX_DIR];
  const proc = spawn(command, {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = proc.stderr
      ? (await new Response(proc.stderr).text()).trim()
      : "";
    throw new Error(
      stderr ||
        `Failed to inspect Convex source changes (exit ${exitCode}): ${command.join(" ")}`
    );
  }

  const status = proc.stdout
    ? await new Response(proc.stdout).text()
    : "";

  return status
    .split("\n")
    .some((line) => line && !line.includes(`${CONVEX_DIR}/_generated/`));
}

async function refreshAthenaConvexGeneratedApi(
  rootDir: string,
  spawn: NonNullable<PreCommitGeneratedArtifactsOptions["spawn"]>
) {
  const command = ["bunx", "convex", "dev", "--once"];
  const proc = spawn(command, {
    cwd: path.join(rootDir, "packages", "athena-webapp"),
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
      `Failed to refresh Convex generated API (exit ${exitCode}): ${command.join(" ")}`
  );
}

async function verifyAthenaConvexGeneratedApi(rootDir: string) {
  const [sourceModules, generatedModules] = await Promise.all([
    collectConvexSourceModules(path.join(rootDir, CONVEX_DIR)),
    readGeneratedConvexApiModules(path.join(rootDir, CONVEX_GENERATED_API_PATH)),
  ]);

  const missingModules = sourceModules.filter(
    (modulePath) => !generatedModules.has(modulePath)
  );

  if (missingModules.length === 0) {
    return;
  }

  throw new Error(
    [
      "Convex generated API is missing module references:",
      ...missingModules.map((modulePath) => `  - ${modulePath}`),
      "",
      "Run `bunx convex dev --once` from packages/athena-webapp to refresh generated client artifacts, then rerun this command. Plain `bunx convex dev` enters watch mode.",
    ].join("\n")
  );
}

async function collectConvexSourceModules(convexDir: string) {
  const modules = await collectConvexSourceModulesFromDir(convexDir, convexDir);
  return modules
    .filter((modulePath) => !CONVEX_API_MODULE_EXCEPTIONS.has(modulePath))
    .sort((left, right) => left.localeCompare(right));
}

async function collectConvexSourceModulesFromDir(rootDir: string, currentDir: string) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const modules: string[] = [];

  for (const entry of entries) {
    if (entry.name === "_generated") {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      modules.push(...(await collectConvexSourceModulesFromDir(rootDir, absolutePath)));
      continue;
    }

    if (
      !entry.isFile() ||
      entry.name.endsWith(".test.ts") ||
      (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js"))
    ) {
      continue;
    }

    modules.push(
      path
        .relative(rootDir, absolutePath)
        .replace(/\.(ts|js)$/, "")
        .split(path.sep)
        .join("/")
    );
  }

  return modules;
}

async function readGeneratedConvexApiModules(apiPath: string) {
  const apiSource = await readFile(apiPath, "utf8");
  const modules = new Set<string>();
  const importRegex = /^import type \* as \w+ from "\.\.\/(.+)\.js";$/gm;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(apiSource))) {
    modules.add(match[1]);
  }

  return modules;
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
  const hasConvexSourceChanges =
    options.hasConvexSourceChanges ??
    ((sourceRootDir) => hasAthenaConvexSourceChanges(sourceRootDir, spawn));
  const refreshConvexGeneratedApi =
    options.refreshConvexGeneratedApi ??
    ((refreshRootDir) => refreshAthenaConvexGeneratedApi(refreshRootDir, spawn));
  const verifyConvexGeneratedApi =
    options.verifyConvexGeneratedApi ?? verifyAthenaConvexGeneratedApi;

  logger.log("[pre-commit] Refreshing generated harness docs...");
  await generateHarnessDocs(rootDir);
  await stageTrackedGeneratedArtifacts(
    rootDir,
    spawn,
    TRACKED_GENERATED_HARNESS_DOCS,
    "harness doc"
  );

  logger.log("[pre-commit] Refreshing Convex generated API when source changed...");
  if (await hasConvexSourceChanges(rootDir)) {
    await refreshConvexGeneratedApi(rootDir);
  }

  logger.log("[pre-commit] Verifying Convex generated API coverage...");
  await verifyConvexGeneratedApi(rootDir);
  await stageTrackedGeneratedArtifacts(
    rootDir,
    spawn,
    TRACKED_CONVEX_GENERATED_ARTIFACTS,
    "Convex generated API"
  );

  logger.log("[pre-commit] Refreshing tracked graphify artifacts...");
  await rebuild(rootDir);
  await stageTrackedGeneratedArtifacts(
    rootDir,
    spawn,
    TRACKED_GRAPHIFY_ARTIFACTS,
    "graphify"
  );

  logger.log("[pre-commit] Staging tracked working-tree changes...");
  await stageTrackedWorkingTreeChanges(rootDir, spawn);
}

export {
  TRACKED_CONVEX_GENERATED_ARTIFACTS,
  TRACKED_GENERATED_HARNESS_DOCS,
  TRACKED_GRAPHIFY_ARTIFACTS,
};

if (import.meta.main) {
  if (Bun.argv.slice(2).some((arg) => arg === "-h" || arg === "--help")) {
    console.log(HELP_TEXT.trim());
    process.exit(0);
  }

  runPreCommitGeneratedArtifacts(process.cwd()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[pre-commit] BLOCKED: ${message}`);
    process.exit(1);
  });
}

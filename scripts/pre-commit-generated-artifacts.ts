import { readdir, readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
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
  "convex.config",
  "schema",
  "storeFront/customer",
]);
const CONVEX_NODE_BIN_ENV = "ATHENA_CONVEX_NODE_BIN";
const SUPPORTED_CONVEX_NODE_MAJORS = new Set([18, 20, 22, 24]);
const CONVEX_DNS_RETRY_DELAY_MS = 1_000;
const CONVEX_DNS_LOOKUP_TIMEOUT_MS = 5_000;
const CONVEX_ATTEMPT_TIMEOUT_MS = 120_000;
const CONVEX_TERMINATION_GRACE_MS = 5_000;

type SpawnedProcess = {
  exited: Promise<number>;
  kill?: (signal?: string) => void;
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
    options: {
      cwd: string;
      stdout: "inherit" | "pipe";
      stderr: "pipe";
      env?: Record<string, string>;
    }
  ) => SpawnedProcess;
  logger?: PreCommitGeneratedArtifactsLogger;
  resolveHostname?: (hostname: string) => Promise<unknown>;
  resolverTimeoutMs?: number;
  convexAttemptTimeoutMs?: number;
  convexTerminationGraceMs?: number;
  retryDelay?: (milliseconds: number) => Promise<void>;
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
    stdout: "pipe",
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
  spawn: NonNullable<PreCommitGeneratedArtifactsOptions["spawn"]>,
  options: Pick<
    PreCommitGeneratedArtifactsOptions,
    | "logger"
    | "resolveHostname"
    | "resolverTimeoutMs"
    | "convexAttemptTimeoutMs"
    | "convexTerminationGraceMs"
    | "retryDelay"
  > = {}
) {
  const command = ["bunx", "convex", "dev", "--once"];
  const nodeBin = await resolveSupportedConvexNodeBin(rootDir, spawn);
  const env = nodeBin
    ? {
        ...stringProcessEnv(),
        PATH: `${path.dirname(nodeBin)}${path.delimiter}${process.env.PATH ?? ""}`,
      }
    : undefined;
  const runConvex = async () => {
    const proc = spawn(command, {
      cwd: path.join(rootDir, "packages", "athena-webapp"),
      stdout: "inherit",
      stderr: "pipe",
      env,
    });
    const exitResult = await waitForProcessExit(
      proc,
      options.convexAttemptTimeoutMs ?? CONVEX_ATTEMPT_TIMEOUT_MS,
      options.convexTerminationGraceMs ?? CONVEX_TERMINATION_GRACE_MS
    );
    if (exitResult.terminationFailed) {
      return {
        exitCode: null,
        stderr: "",
        timedOut: true,
        terminationFailed: true,
      } as const;
    }
    if (exitResult.timedOut) {
      return {
        exitCode: null,
        stderr: "",
        timedOut: true,
        terminationFailed: false,
      } as const;
    }
    const stderr = proc.stderr
      ? (await new Response(proc.stderr).text()).trim()
      : "";
    return {
      exitCode: exitResult.exitCode,
      stderr,
      timedOut: false,
      terminationFailed: false,
    } as const;
  };

  const firstAttempt = await runConvex();
  if (firstAttempt.exitCode === 0) return;
  if (firstAttempt.terminationFailed) {
    throw new Error(formatConvexTerminationFailure());
  }

  const failureMessage =
    firstAttempt.stderr ||
    `Failed to refresh Convex generated API (exit ${firstAttempt.exitCode}): ${command.join(" ")}`;
  if (!firstAttempt.timedOut && !isGenericFetchFailure(firstAttempt.stderr)) {
    throw new Error(failureMessage);
  }

  const hostname = await resolveConvexDeploymentHostname(rootDir);
  if (!hostname) {
    throw new Error(failureMessage);
  }

  const resolveHostname = options.resolveHostname ?? lookup;
  let resolverError: unknown;
  try {
    await resolveHostnameWithTimeout(
      resolveHostname,
      hostname,
      options.resolverTimeoutMs ?? CONVEX_DNS_LOOKUP_TIMEOUT_MS
    );
  } catch (error) {
    resolverError = error;
  }
  if (!resolverError) {
    throw new Error(
      firstAttempt.timedOut
        ? `Convex generated API refresh timed out after ${options.convexAttemptTimeoutMs ?? CONVEX_ATTEMPT_TIMEOUT_MS}ms while DNS for ${hostname} resolved successfully.`
        : failureMessage
    );
  }

  options.logger?.log(
    `[pre-commit] Convex deployment DNS lookup failed for ${hostname}; retrying once after ${CONVEX_DNS_RETRY_DELAY_MS}ms...`
  );
  await (options.retryDelay ?? delay)(CONVEX_DNS_RETRY_DELAY_MS);
  const retryAttempt = await runConvex();
  if (retryAttempt.exitCode === 0) return;
  if (retryAttempt.terminationFailed) {
    throw new Error(formatConvexTerminationFailure());
  }
  if (!retryAttempt.timedOut && !isGenericFetchFailure(retryAttempt.stderr)) {
    throw new Error(
      retryAttempt.stderr ||
        `Failed to refresh Convex generated API (exit ${retryAttempt.exitCode}): ${command.join(" ")}`
    );
  }

  throw new Error(formatConvexDnsFailure(hostname, resolverError));
}

async function waitForProcessExit(
  proc: SpawnedProcess,
  timeoutMs: number,
  terminationGraceMs: number
) {
  const initialExit = await waitForExitWithin(proc.exited, timeoutMs);
  if (initialExit !== null) {
    return {
      timedOut: false,
      terminationFailed: false,
      exitCode: initialExit,
    } as const;
  }

  proc.kill?.("SIGTERM");
  const terminatedExit = await waitForExitWithin(proc.exited, terminationGraceMs);
  if (terminatedExit !== null) {
    return { timedOut: true, terminationFailed: false, exitCode: null } as const;
  }

  proc.kill?.("SIGKILL");
  const killedExit = await waitForExitWithin(proc.exited, terminationGraceMs);
  return {
    timedOut: true,
    terminationFailed: killedExit === null,
    exitCode: null,
  } as const;
}

function waitForExitWithin(exited: Promise<number>, timeoutMs: number) {
  return new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    exited.then((exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
}

function formatConvexTerminationFailure() {
  return "Convex generated API refresh timed out and the child process did not exit after SIGTERM and SIGKILL. No retry or artifact verification was started; stop the remaining Convex process before rerunning.";
}

function resolveHostnameWithTimeout(
  resolveHostname: (hostname: string) => Promise<unknown>,
  hostname: string,
  timeoutMs: number
) {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`DNS lookup timed out after ${timeoutMs}ms`), {
            code: "ETIMEDOUT",
          })
        ),
      timeoutMs
    );
    resolveHostname(hostname).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isGenericFetchFailure(stderr: string) {
  return /(?:TypeError:\s*)?fetch failed/i.test(stderr);
}

async function resolveConvexDeploymentHostname(rootDir: string) {
  const webappDir = path.join(rootDir, "packages", "athena-webapp");
  const envValues: Record<string, string> = {};
  try {
    const source = await readFile(path.join(webappDir, ".env.local"), "utf8");
    for (const line of source.split("\n")) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*["']?([^"'\s#]+)["']?/);
      if (match) envValues[match[1]] = match[2];
    }
  } catch {
    // The Convex CLI may be configured entirely through the process environment.
  }

  const deploymentUrl =
    process.env.CONVEX_URL ??
    process.env.VITE_CONVEX_URL ??
    envValues.CONVEX_URL ??
    envValues.VITE_CONVEX_URL;
  if (deploymentUrl) {
    try {
      return new URL(deploymentUrl).hostname;
    } catch {
      return null;
    }
  }

  const deployment = process.env.CONVEX_DEPLOYMENT ?? envValues.CONVEX_DEPLOYMENT;
  const deploymentName = deployment?.split(":").at(-1);
  return deploymentName ? `${deploymentName}.convex.cloud` : null;
}

function formatConvexDnsFailure(hostname: string, error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "unknown resolver error";
  return [
    `DNS resolution failed for ${hostname} through the system resolver (${code}).`,
    "The harness retried `bunx convex dev --once` once and the deployment remained unreachable.",
    "This harness does not change system DNS. Check VPN/network DNS, verify the hostname with your platform's resolver tools, then rerun `bun run pre-commit:generated-artifacts`.",
  ].join("\n");
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function stringProcessEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

async function resolveSupportedConvexNodeBin(
  rootDir: string,
  spawn: NonNullable<PreCommitGeneratedArtifactsOptions["spawn"]>
) {
  const candidates = [
    process.env[CONVEX_NODE_BIN_ENV],
    process.env.NODE_BINARY,
    process.env.HOME
      ? path.join(
          process.env.HOME,
          ".cache",
          "codex-runtimes",
          "codex-primary-runtime",
          "dependencies",
          "node",
          "bin",
          "node"
        )
      : undefined,
    "/opt/homebrew/opt/node@24/bin/node",
    "/opt/homebrew/opt/node@22/bin/node",
    "/opt/homebrew/opt/node@20/bin/node",
    "/opt/homebrew/opt/node@18/bin/node",
    "/usr/local/opt/node@24/bin/node",
    "/usr/local/opt/node@22/bin/node",
    "/usr/local/opt/node@20/bin/node",
    "/usr/local/opt/node@18/bin/node",
    "node",
  ].filter((candidate): candidate is string => Boolean(candidate));
  const seenCandidates = new Set<string>();
  const checkedVersions: string[] = [];

  for (const candidate of candidates) {
    if (seenCandidates.has(candidate)) {
      continue;
    }
    seenCandidates.add(candidate);

    const version = await readCommandStdout(spawn, [candidate, "-v"], rootDir);
    if (!version) {
      continue;
    }
    checkedVersions.push(`${candidate} => ${version}`);

    const major = Number(version.trim().replace(/^v/, "").split(".")[0]);
    if (SUPPORTED_CONVEX_NODE_MAJORS.has(major)) {
      return candidate.includes(path.sep) ? candidate : null;
    }
  }

  throw new Error(
    [
      "Convex generated API refresh requires Node.js 18, 20, 22, or 24 because Convex deploys node actions during `convex dev --once`.",
      `Install a supported Node version or set ${CONVEX_NODE_BIN_ENV}=/absolute/path/to/node before rerunning.`,
      checkedVersions.length > 0
        ? `Checked Node candidates:\n${checkedVersions.map((entry) => `  - ${entry}`).join("\n")}`
        : "No Node candidates could be executed.",
    ].join("\n")
  );
}

async function readCommandStdout(
  spawn: NonNullable<PreCommitGeneratedArtifactsOptions["spawn"]>,
  command: string[],
  cwd: string
) {
  const proc = spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0 || !proc.stdout) {
    return null;
  }

  return (await new Response(proc.stdout).text()).trim();
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
    ((refreshRootDir) =>
      refreshAthenaConvexGeneratedApi(refreshRootDir, spawn, {
        logger,
        resolveHostname: options.resolveHostname,
        resolverTimeoutMs: options.resolverTimeoutMs,
        convexAttemptTimeoutMs: options.convexAttemptTimeoutMs,
        convexTerminationGraceMs: options.convexTerminationGraceMs,
        retryDelay: options.retryDelay,
      }));
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

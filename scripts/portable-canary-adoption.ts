/**
 * Read-only admission sensor and disposable rollback rehearsal for Athena's
 * single portable workflow canary.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  isPortableShadowComparison,
  portableShadowComparisonSha256,
} from "./portable-shadow-observation";

const WORKFLOW = "compound-delivery-kernel";
const RELEASE_ID = "core-v1";
const PROFILE = "core";
const ARCHIVE_SHA256 =
  "004bfcf1c8d245a75d9f696d9f1ac83af4b0e6f2c90a48e3927a916a5b8c5ef8";
const METADATA_SHA256 =
  "20b0194b082510d1cb2b7bbbe217888eac444fa28f4610819c76f194493d5e81";
const WORKFLOW_SHA256 =
  "d7a651c9392a36f923784771f24a532acca81fa223b865be46cba842c061e706";
const PREDECESSOR_SHA256 =
  "30d72ae4d855b508b7ab59720874e8e76091885992a712d3bd5ccb6e510d451e";
const SOURCE_COMMIT_SHA = "ddd04495d4fd5d8bac214cb4b81f9dd985d8dd0d";
const ACCEPTED_SHADOW_SHA256 =
  "26e0035003608463f9252764a8704bc06fce545ba82be37c109072bdab0d068d";
const RECORD_PATH = ".agents/migrations/portable-kernel-canary.json";

type CanaryRecord = {
  schemaVersion: "athena-portable-canary/1";
  workflow: typeof WORKFLOW;
  authority: "portable";
  release: {
    releaseId: typeof RELEASE_ID;
    profile: typeof PROFILE;
    sourceCommitSha: typeof SOURCE_COMMIT_SHA;
    archivePath: ".agents/portable/releases/core-v1.zip";
    metadataPath: ".agents/portable/releases/core-v1.release.json";
    archiveSha256: typeof ARCHIVE_SHA256;
    metadataSha256: typeof METADATA_SHA256;
    workflowSha256: typeof WORKFLOW_SHA256;
  };
  acceptedShadow: {
    telemetryPath: "telemetry/delivery-runs/2026-08-28T20-20-17-363Z-codex-v26-1429-shadow-canary.json";
    comparisonSha256: typeof ACCEPTED_SHADOW_SHA256;
  };
  lifecycle: {
    receiptPath: ".agent-skills/active.json";
    predecessorSha256: typeof PREDECESSOR_SHA256;
    exposedHosts: ["claude-code", "codex"];
  };
  rollback: {
    pythonPath: ".agent-skills/current";
    command: [
      "python3",
      "-m",
      "agent_skills.cli",
      "--root",
      ".",
      "rollback",
      "--maintenance",
    ];
    sourceIndependent: true;
  };
};

export type PortableCanaryFinding = {
  code: string;
  message: string;
  path?: string;
};

type LifecycleStatus = {
  active?: {
    archiveSha256?: string;
    profile?: string;
    releaseId?: string;
    selectedSkills?: string[];
  } | null;
  blockers?: unknown[];
  lifecycle?: string;
};

type ActiveReceipt = {
  adoption?: {
    predecessorHosts?: string[];
    predecessorSha256?: string;
    skill?: string;
  };
  exposures?: Array<{
    host?: string;
    mode?: string;
    root?: string;
  }>;
};

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson<T>(absolutePath: string): Promise<T> {
  return JSON.parse(await readFile(absolutePath, "utf8")) as T;
}

function exactKeys(value: unknown, keys: readonly string[]) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function validateRecord(value: unknown): value is CanaryRecord {
  if (
    !exactKeys(value, [
      "acceptedShadow",
      "authority",
      "lifecycle",
      "release",
      "rollback",
      "schemaVersion",
      "workflow",
    ])
  ) {
    return false;
  }
  const record = value as CanaryRecord;
  return (
    record.schemaVersion === "athena-portable-canary/1" &&
    record.workflow === WORKFLOW &&
    record.authority === "portable" &&
    exactKeys(record.release, [
      "archivePath",
      "archiveSha256",
      "metadataPath",
      "metadataSha256",
      "profile",
      "releaseId",
      "sourceCommitSha",
      "workflowSha256",
    ]) &&
    record.release.releaseId === RELEASE_ID &&
    record.release.profile === PROFILE &&
    record.release.sourceCommitSha === SOURCE_COMMIT_SHA &&
    record.release.archivePath === ".agents/portable/releases/core-v1.zip" &&
    record.release.metadataPath ===
      ".agents/portable/releases/core-v1.release.json" &&
    record.release.archiveSha256 === ARCHIVE_SHA256 &&
    record.release.metadataSha256 === METADATA_SHA256 &&
    record.release.workflowSha256 === WORKFLOW_SHA256 &&
    exactKeys(record.acceptedShadow, ["comparisonSha256", "telemetryPath"]) &&
    record.acceptedShadow.telemetryPath ===
      "telemetry/delivery-runs/2026-08-28T20-20-17-363Z-codex-v26-1429-shadow-canary.json" &&
    record.acceptedShadow.comparisonSha256 === ACCEPTED_SHADOW_SHA256 &&
    exactKeys(record.lifecycle, [
      "exposedHosts",
      "predecessorSha256",
      "receiptPath",
    ]) &&
    record.lifecycle.receiptPath === ".agent-skills/active.json" &&
    record.lifecycle.predecessorSha256 === PREDECESSOR_SHA256 &&
    JSON.stringify(record.lifecycle.exposedHosts) ===
      JSON.stringify(["claude-code", "codex"]) &&
    exactKeys(record.rollback, [
      "command",
      "pythonPath",
      "sourceIndependent",
    ]) &&
    record.rollback.pythonPath === ".agent-skills/current" &&
    JSON.stringify(record.rollback.command) ===
      JSON.stringify([
        "python3",
        "-m",
        "agent_skills.cli",
        "--root",
        ".",
        "rollback",
        "--maintenance",
      ]) &&
    record.rollback.sourceIndependent === true
  );
}

function pythonEnvironment(pythonPath: string) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    PYTHONPATH: pythonPath,
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  };
}

async function runLifecycle(
  rootDir: string,
  pythonPath: string,
  arguments_: string[],
) {
  const { stdout, stderr, exitCode } = await runCommand(
    "python3",
    ["-m", "agent_skills.cli", "--root", rootDir, ...arguments_],
    rootDir,
    pythonEnvironment(pythonPath),
  );
  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() || stdout.trim() || "lifecycle command failed",
    );
  }
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function runCommand(
  command: string,
  arguments_: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  return await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, env, stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) =>
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: exitCode ?? 1,
      }),
    );
  });
}

async function loadRecord(rootDir: string) {
  const absolutePath = path.join(rootDir, RECORD_PATH);
  const value = await readJson<unknown>(absolutePath);
  if (!validateRecord(value)) {
    throw new Error("portable canary migration record is malformed");
  }
  return value;
}

export type PortableCanaryBaselineProjection = {
  logicalSkillDirectory: `.agents/skills/${typeof WORKFLOW}`;
  logicalSkillFile: `.agents/skills/${typeof WORKFLOW}/SKILL.md`;
  predecessorFile: `.agent-skills/predecessors/${string}/SKILL.md`;
  ignoredDiscoveryPaths: [`.claude/skills/${typeof WORKFLOW}`];
};

export async function loadPortableCanaryBaselineProjection(
  rootDir: string,
): Promise<PortableCanaryBaselineProjection> {
  const record = await loadRecord(rootDir);
  const logicalSkillDirectory = `.agents/skills/${WORKFLOW}` as const;
  const logicalSkillFile = `${logicalSkillDirectory}/SKILL.md` as const;
  const predecessorFile =
    `.agent-skills/predecessors/${record.lifecycle.predecessorSha256}/SKILL.md` as const;
  const predecessor = await readFile(path.join(rootDir, predecessorFile));
  if (sha256(predecessor) !== record.lifecycle.predecessorSha256) {
    throw new Error(
      "portable canary predecessor does not match the baseline digest",
    );
  }
  const expectedTarget = `../../.agent-skills/current/skills/${WORKFLOW}`;
  for (const exposure of [
    logicalSkillDirectory,
    `.claude/skills/${WORKFLOW}`,
  ]) {
    const stat = await lstat(path.join(rootDir, exposure));
    if (
      !stat.isSymbolicLink() ||
      (await readlink(path.join(rootDir, exposure))) !== expectedTarget
    ) {
      throw new Error(`portable canary exposure ${exposure} is not current`);
    }
  }
  const claudeEntries = await readdir(path.join(rootDir, ".claude/skills"));
  if (JSON.stringify(claudeEntries.sort()) !== JSON.stringify([WORKFLOW])) {
    throw new Error(
      "Claude discovery contains content outside the single portable canary",
    );
  }
  return {
    logicalSkillDirectory,
    logicalSkillFile,
    predecessorFile,
    ignoredDiscoveryPaths: [`.claude/skills/${WORKFLOW}`],
  };
}

export async function auditPortableCanaryAdoption(rootDir: string) {
  const findings: PortableCanaryFinding[] = [];
  let record: CanaryRecord;
  try {
    record = await loadRecord(rootDir);
  } catch (error: unknown) {
    findings.push({
      code: "canary-record-invalid",
      message: error instanceof Error ? error.message : String(error),
      path: RECORD_PATH,
    });
    return {
      ok: false,
      findings,
      summary: "[portable-canary] Canary record is unavailable.",
    };
  }

  const archivePath = path.join(rootDir, record.release.archivePath);
  const metadataPath = path.join(rootDir, record.release.metadataPath);
  const [archiveBytes, metadataBytes] = await Promise.all([
    readFile(archivePath),
    readFile(metadataPath),
  ]);
  if (sha256(archiveBytes) !== record.release.archiveSha256) {
    findings.push({
      code: "canary-archive-drift",
      message:
        "The active canary archive no longer matches its qualified digest.",
      path: record.release.archivePath,
    });
  }
  if (sha256(metadataBytes) !== record.release.metadataSha256) {
    findings.push({
      code: "canary-metadata-drift",
      message:
        "The active canary metadata no longer matches its qualified digest.",
      path: record.release.metadataPath,
    });
  }

  const telemetry = await readJson<{ shadowComparison?: unknown }>(
    path.join(rootDir, record.acceptedShadow.telemetryPath),
  );
  const comparison = telemetry.shadowComparison;
  if (
    !isPortableShadowComparison(comparison) ||
    comparison.status !== "match" ||
    comparison.mismatches.length !== 0 ||
    comparison.portableMutationAttempts.length !== 0 ||
    portableShadowComparisonSha256(comparison) !==
      record.acceptedShadow.comparisonSha256
  ) {
    findings.push({
      code: "canary-shadow-not-accepted",
      message:
        "The canary is not bound to the accepted zero-mismatch, zero-mutation shadow comparison.",
      path: record.acceptedShadow.telemetryPath,
    });
  }

  const managedCurrent = path.join(rootDir, ".agent-skills/current");
  try {
    const status = (await runLifecycle(rootDir, managedCurrent, [
      "status",
    ])) as LifecycleStatus;
    if (
      status.lifecycle !== "current" ||
      !Array.isArray(status.blockers) ||
      status.blockers.length !== 0 ||
      status.active?.releaseId !== RELEASE_ID ||
      status.active.profile !== PROFILE ||
      status.active.archiveSha256 !== ARCHIVE_SHA256 ||
      JSON.stringify(status.active.selectedSkills) !==
        JSON.stringify([WORKFLOW])
    ) {
      throw new Error(
        "active lifecycle status does not match the canary record",
      );
    }
    const receipt = await readJson<ActiveReceipt>(
      path.join(rootDir, record.lifecycle.receiptPath),
    );
    if (
      JSON.stringify(receipt.adoption) !==
        JSON.stringify({
          predecessorHosts: ["codex"],
          predecessorSha256: PREDECESSOR_SHA256,
          skill: WORKFLOW,
        }) ||
      JSON.stringify(receipt.exposures) !==
        JSON.stringify([
          {
            host: "codex",
            mode: "relative-symlink",
            root: ".agents/skills",
          },
          {
            host: "claude-code",
            mode: "relative-symlink",
            root: ".claude/skills",
          },
        ])
    ) {
      throw new Error(
        "active lifecycle receipt does not match the canary record",
      );
    }
  } catch (error: unknown) {
    findings.push({
      code: "canary-lifecycle-invalid",
      message: error instanceof Error ? error.message : String(error),
      path: record.lifecycle.receiptPath,
    });
  }

  for (const hostPath of [
    `.agents/skills/${WORKFLOW}`,
    `.claude/skills/${WORKFLOW}`,
  ]) {
    try {
      const stat = await lstat(path.join(rootDir, hostPath));
      const target = await readlink(path.join(rootDir, hostPath));
      if (
        !stat.isSymbolicLink() ||
        target !== `../../.agent-skills/current/skills/${WORKFLOW}`
      ) {
        throw new Error(
          "exposure does not target the managed current generation",
        );
      }
    } catch (error: unknown) {
      findings.push({
        code: "canary-host-exposure-invalid",
        message: `${hostPath}: ${error instanceof Error ? error.message : String(error)}`,
        path: hostPath,
      });
    }
  }

  try {
    const body = await readFile(
      path.join(managedCurrent, "skills", WORKFLOW, "SKILL.md"),
    );
    if (sha256(body) !== WORKFLOW_SHA256) {
      throw new Error(
        "portable workflow digest disagrees with the qualified release",
      );
    }
    const predecessor = await readFile(
      path.join(
        rootDir,
        ".agent-skills/predecessors",
        record.lifecycle.predecessorSha256,
        "SKILL.md",
      ),
    );
    if (sha256(predecessor) !== record.lifecycle.predecessorSha256) {
      throw new Error("retained Athena predecessor digest disagrees");
    }
  } catch (error: unknown) {
    findings.push({
      code: "canary-body-invalid",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    ok: findings.length === 0,
    findings,
    summary:
      findings.length === 0
        ? `[portable-canary] ${WORKFLOW} is active from ${RELEASE_ID} for codex and claude-code; rollback remains retained.`
        : `[portable-canary] Found ${findings.length} canary issue(s).`,
  };
}

const EXTRACT_DRIVER = String.raw`
import pathlib, sys, zipfile
archive, destination = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(archive) as bundle:
    bundle.extractall(destination)
`;

export async function rehearsePortableCanaryRollback(rootDir: string) {
  const record = await loadRecord(rootDir);
  const rehearsalRoot = await mkdtemp(
    path.join(tmpdir(), "athena-portable-canary-rollback-"),
  );
  try {
    const archivePath = path.join(rehearsalRoot, "core-v1.zip");
    const metadataPath = path.join(rehearsalRoot, "core-v1.release.json");
    const driverPath = path.join(rehearsalRoot, "driver");
    const predecessorPath = path.join(
      rootDir,
      ".agent-skills/predecessors",
      record.lifecycle.predecessorSha256,
      "SKILL.md",
    );
    const predecessor = await readFile(predecessorPath);
    const localSkillRoot = path.join(rehearsalRoot, ".agents/skills", WORKFLOW);
    const unrelatedPath = path.join(rehearsalRoot, "unrelated.txt");
    const unrelatedBytes = "unrelated dirty work remains byte-identical\n";
    await Promise.all([
      mkdir(localSkillRoot, { recursive: true }),
      mkdir(driverPath, { recursive: true }),
      copyFile(path.join(rootDir, record.release.archivePath), archivePath),
      copyFile(path.join(rootDir, record.release.metadataPath), metadataPath),
      writeFile(unrelatedPath, unrelatedBytes),
    ]);
    await writeFile(path.join(localSkillRoot, "SKILL.md"), predecessor);
    const gitInit = await runCommand(
      "git",
      ["init", "--quiet"],
      rehearsalRoot,
      process.env,
    );
    if (gitInit.exitCode !== 0) {
      throw new Error(
        `rollback fixture Git init failed: ${gitInit.stderr.trim()}`,
      );
    }

    const extraction = await runCommand(
      "python3",
      ["-c", EXTRACT_DRIVER, archivePath, driverPath],
      rehearsalRoot,
      pythonEnvironment(""),
    );
    if (extraction.exitCode !== 0) {
      throw new Error(
        `portable release extraction failed: ${extraction.stderr.trim()}`,
      );
    }
    await runLifecycle(rehearsalRoot, driverPath, [
      "adopt",
      "--archive",
      archivePath,
      "--metadata",
      metadataPath,
      "--skill",
      WORKFLOW,
      "--expected-prior-sha256",
      record.lifecycle.predecessorSha256,
      "--maintenance",
    ]);

    await Promise.all([
      unlink(archivePath),
      unlink(metadataPath),
      rm(driverPath, { recursive: true }),
    ]);
    await runLifecycle(
      rehearsalRoot,
      path.join(rehearsalRoot, ".agent-skills/current"),
      ["rollback", "--maintenance"],
    );

    const [restored, unrelatedAfter] = await Promise.all([
      readFile(path.join(localSkillRoot, "SKILL.md")),
      readFile(unrelatedPath, "utf8"),
    ]);
    let claudeExposureAbsent = false;
    try {
      await lstat(path.join(rehearsalRoot, ".claude/skills", WORKFLOW));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      claudeExposureAbsent = true;
    }
    return {
      restored:
        sha256(restored) === record.lifecycle.predecessorSha256 &&
        claudeExposureAbsent,
      sourceIndependent: true,
      unrelatedBytesPreserved: unrelatedAfter === unrelatedBytes,
    };
  } finally {
    await rm(rehearsalRoot, { recursive: true, force: true });
  }
}

async function main() {
  const rootDir = path.resolve(process.argv[2] ?? ".");
  const audit = await auditPortableCanaryAdoption(rootDir);
  const rollback = audit.ok
    ? await rehearsePortableCanaryRollback(rootDir)
    : {
        restored: false,
        sourceIndependent: false,
        unrelatedBytesPreserved: false,
      };
  console.log(audit.summary);
  for (const finding of audit.findings) {
    console.error(`${finding.code}: ${finding.message}`);
  }
  console.log(
    `[portable-canary] Rollback rehearsal: restored=${rollback.restored}; source-independent=${rollback.sourceIndependent}; unrelated-bytes-preserved=${rollback.unrelatedBytesPreserved}.`,
  );
  if (
    !audit.ok ||
    !rollback.restored ||
    !rollback.sourceIndependent ||
    !rollback.unrelatedBytesPreserved
  ) {
    process.exitCode = 1;
  }
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  await main();
}

/**
 * Read-only admission sensor and disposable rollback rehearsal for Athena's
 * ordered portable workflow batches.
 */
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { auditPortableCanaryAdoption } from "./portable-canary-adoption";

const RECORD_PATH = ".agents/migrations/portable-workflow-batches.json";
const RELEASE_ID = "core-v1";
const ARCHIVE_SHA256 =
  "f8b39590bae786767cff1cfd849382884a0b66f12ef9978f752dbcb28c230f26";
const METADATA_SHA256 =
  "cd0094de0eba4077e05af0c12e10b2a692d93e30e58b7d6aa8495cb0a53899fe";
const ACCEPTED_SHADOW_SHA256 =
  "26e0035003608463f9252764a8704bc06fce545ba82be37c109072bdab0d068d";
const PREDECESSOR_SHA256 =
  "2c0b38d4bd55e58923e8cb8a9aed1e142d27b8ea62cdaa03600d33054f2018d6";
const PREDECESSOR_PATH =
  `.agent-skills/batch-predecessors/${PREDECESSOR_SHA256}` as const;
const PRIMITIVE_WORKFLOWS = [
  "plan-work",
  "execute-work",
  "review-work",
  "compound-learning",
] as const;
const WORKFLOW_SHA256 = {
  "compound-learning":
    "3074dd2cd2600185dc420973c5c762b4222fdc60671992ecfbbbd9878e949521",
  "deliver-work":
    "11a3f8839a15754a511b787c05e809447aebe871e9dcdc7bdd0a18f1f1f357fa",
  "execute-work":
    "33ee613ce298fb17935d6788a5485130c141dc82439eec2a501cb110be8ec3e4",
  "plan-work":
    "4347893b7bbe1ea0e60240713082e51a4d13c6b945f7822579f480628d1036bd",
  "review-work":
    "7858bf1bc9494bbb9f13a32bb472c6ea0614d9a7200d2e4e967f031ebecff152",
} as const;
const PREDECESSOR_FILES = [
  {
    path: "SKILL.md",
    sha256:
      "8e4f79aa196e549fbd039a6bbeca9106c1d5e50e607df59c3ae753b380f4371c",
  },
  {
    path: "agents/openai.yaml",
    sha256:
      "335c1f6f152230f5c7dfac0bce52bd2295d4f44349226eac3fc59de1715d2c04",
  },
] as const;
const INVENTORY = [
  ["routing-and-repository-discovery", "portable-candidate", "migrated"],
  ["planning-workflow", "portable-candidate", "migrated"],
  ["test-and-handoff-posture", "portable-candidate", "migrated"],
  ["review-workflow", "portable-candidate", "migrated"],
  ["tracker-neutral-capability-contract", "portable-candidate", "migrated"],
  ["linear-tracker-adapter", "optional-adapter", "optional-adapter"],
  ["compound-workflow", "portable-candidate", "migrated"],
  ["athena-harness-evidence", "retained-overlay", "retained-overlay"],
  ["athena-merge-ready-gates", "retained-overlay", "retained-overlay"],
  ["athena-reporting-policy", "retained-overlay", "retained-overlay"],
  ["athena-telemetry-policy", "retained-overlay", "retained-overlay"],
  ["athena-deployment-handoff", "retained-overlay", "retained-overlay"],
  ["athena-generated-artifacts", "retained-overlay", "retained-overlay"],
  ["athena-pr-policy", "retained-overlay", "retained-overlay"],
  ["athena-domain-rules", "excluded", "excluded"],
  ["compound-reviewer-prompt-graph", "excluded", "excluded"],
  ["codex-host-exposure-metadata", "optional-adapter", "optional-adapter"],
  ["host-tool-sequence", "excluded", "excluded"],
] as const;

const EXPECTED_RECORD = {
  schemaVersion: "athena-portable-workflow-batches/1",
  release: {
    releaseId: RELEASE_ID,
    profile: "core",
    sourceCommitSha: "f0a058d7b40a38bbe43c007f8b11248ecd4bda6a",
    archivePath: ".agents/portable/releases/core-v1.zip",
    metadataPath: ".agents/portable/releases/core-v1.release.json",
    archiveSha256: ARCHIVE_SHA256,
    metadataSha256: METADATA_SHA256,
  },
  prerequisite: {
    canaryRecordPath: ".agents/migrations/portable-kernel-canary.json",
    acceptedShadowComparisonSha256: ACCEPTED_SHADOW_SHA256,
  },
  exposedHosts: ["claude-code", "codex"],
  batches: [
    {
      id: "workflow-primitives",
      dependsOn: ["portable-kernel-canary"],
      workflows: PRIMITIVE_WORKFLOWS.map((id) => ({
        id,
        sha256: WORKFLOW_SHA256[id],
      })),
      rollback: {
        action: "remove-exposures",
        sourceIndependent: true,
      },
    },
    {
      id: "delivery-entrypoint",
      dependsOn: ["workflow-primitives"],
      workflows: [
        { id: "deliver-work", sha256: WORKFLOW_SHA256["deliver-work"] },
      ],
      rollback: {
        action: "restore-predecessor",
        predecessorPath: PREDECESSOR_PATH,
        predecessorSha256: PREDECESSOR_SHA256,
        predecessorHosts: ["codex"],
        sourceIndependent: true,
      },
    },
  ],
  inventory: INVENTORY.map(([id, sourceClassification, outcome]) => ({
    id,
    sourceClassification,
    outcome,
  })),
};

type BatchRecord = typeof EXPECTED_RECORD;

type OverlayMap = {
  classifications?: Array<{ id?: string; classification?: string }>;
};

export type PortableBatchFinding = {
  code: string;
  message: string;
  path?: string;
};

export type PortableBatchBaselineProjection = {
  fileProjections: Array<{ logicalPath: string; predecessorPath: string }>;
  ignoredDiscoveryPaths: string[];
};

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson<T>(absolutePath: string): Promise<T> {
  return JSON.parse(await readFile(absolutePath, "utf8")) as T;
}

async function loadBatchRecord(rootDir: string): Promise<BatchRecord> {
  const value = await readJson(path.join(rootDir, RECORD_PATH));
  if (!isDeepStrictEqual(value, EXPECTED_RECORD)) {
    throw new Error("portable workflow batch record is not current");
  }
  return value as BatchRecord;
}

function hostRoot(host: "claude-code" | "codex") {
  return host === "codex" ? ".agents/skills" : ".claude/skills";
}

async function isExactRelativeLink(absolutePath: string, expected: string) {
  try {
    const status = await lstat(absolutePath);
    return status.isSymbolicLink() && (await readlink(absolutePath)) === expected;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function auditPredecessor(
  rootDir: string,
  findings: PortableBatchFinding[],
) {
  const root = path.join(rootDir, PREDECESSOR_PATH);
  try {
    const files = await Promise.all(
      PREDECESSOR_FILES.map(async (entry) => ({
        path: entry.path,
        sha256: sha256(await readFile(path.join(root, "deliver-work", entry.path))),
      })),
    );
    const contentSha256 = sha256(JSON.stringify(files));
    if (
      !isDeepStrictEqual(files, PREDECESSOR_FILES.map((entry) => ({ ...entry }))) ||
      contentSha256 !== PREDECESSOR_SHA256
    ) {
      findings.push({
        code: "batch-predecessor-drift",
        message: "The retained deliver-work predecessor no longer matches its exact content identity.",
        path: PREDECESSOR_PATH,
      });
    }
  } catch {
    findings.push({
      code: "batch-predecessor-drift",
      message: "The retained deliver-work predecessor is missing or unreadable.",
      path: PREDECESSOR_PATH,
    });
  }
}

export async function auditPortableBatchAdoption(rootDir: string) {
  const findings: PortableBatchFinding[] = [];
  let record: BatchRecord | null = null;
  try {
    record = await loadBatchRecord(rootDir);
  } catch {
    findings.push({
      code: "batch-record-invalid",
      message: "The portable workflow batch record is missing or differs from the approved ordered migration.",
      path: RECORD_PATH,
    });
  }

  const canary = await auditPortableCanaryAdoption(rootDir);
  if (!canary.ok) {
    findings.push({
      code: "batch-canary-prerequisite-invalid",
      message: "The accepted portable kernel canary is not current and green.",
      path: ".agents/migrations/portable-kernel-canary.json",
    });
  }

  if (record !== null) {
    const overlayMap = await readJson<OverlayMap>(
        path.join(rootDir, ".agents/portable-overlay-map.json"),
      ).catch(() => null);
    const expectedClassifications = INVENTORY.map(([id, classification]) => ({
      id,
      classification,
    }));
    const actualClassifications = overlayMap?.classifications?.map(
      ({ id, classification }) => ({ id, classification }),
    );
    if (!isDeepStrictEqual(actualClassifications, expectedClassifications)) {
      findings.push({
        code: "batch-inventory-drift",
        message: "The baseline classification inventory no longer matches the batch disposition record.",
        path: ".agents/portable-overlay-map.json",
      });
    }
  }

  for (const [workflow, expectedSha256] of Object.entries(WORKFLOW_SHA256)) {
    const workflowPath = `.agent-skills/current/skills/${workflow}/SKILL.md`;
    try {
      if (sha256(await readFile(path.join(rootDir, workflowPath))) !== expectedSha256) {
        throw new Error();
      }
    } catch {
      findings.push({
        code: "batch-workflow-drift",
        message: `Portable workflow ${workflow} no longer matches the exact qualified release.`,
        path: workflowPath,
      });
    }
    for (const host of ["codex", "claude-code"] as const) {
      const exposurePath = `${hostRoot(host)}/${workflow}`;
      const expectedTarget = `../../.agent-skills/current/skills/${workflow}`;
      if (
        !(await isExactRelativeLink(
          path.join(rootDir, exposurePath),
          expectedTarget,
        ))
      ) {
        findings.push({
          code: "batch-host-exposure-invalid",
          message: `${host} does not expose ${workflow} exactly once from the active release.`,
          path: exposurePath,
        });
      }
    }
  }

  await auditPredecessor(rootDir, findings);

  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `[portable-batches] ${RELEASE_ID} exposes 5 remaining portable workflows in 2 reversible batches; 6 baseline capabilities are migrated and Athena overlays remain local.`
        : `[portable-batches] Found ${findings.length} batch adoption issue(s).`,
  };
}

export async function loadPortableBatchBaselineProjection(
  rootDir: string,
): Promise<PortableBatchBaselineProjection> {
  await loadBatchRecord(rootDir);
  const predecessorFindings: PortableBatchFinding[] = [];
  await auditPredecessor(rootDir, predecessorFindings);
  if (predecessorFindings.length > 0) {
    throw new Error("portable workflow batch predecessor is not current");
  }
  for (const workflow of Object.keys(WORKFLOW_SHA256)) {
    for (const host of ["codex", "claude-code"] as const) {
      const exposurePath = `${hostRoot(host)}/${workflow}`;
      if (
        !(await isExactRelativeLink(
          path.join(rootDir, exposurePath),
          `../../.agent-skills/current/skills/${workflow}`,
        ))
      ) {
        throw new Error(`portable workflow batch exposure ${exposurePath} is not current`);
      }
    }
  }
  return {
    fileProjections: PREDECESSOR_FILES.map((entry) => ({
      logicalPath: `.agents/skills/deliver-work/${entry.path}`,
      predecessorPath: `${PREDECESSOR_PATH}/deliver-work/${entry.path}`,
    })),
    ignoredDiscoveryPaths: Object.keys(WORKFLOW_SHA256).flatMap((workflow) => [
      `.agents/skills/${workflow}`,
      `.claude/skills/${workflow}`,
    ]),
  };
}

async function pathAbsent(absolutePath: string) {
  try {
    await lstat(absolutePath);
    return false;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export async function rehearsePortableBatchRollback(rootDir: string) {
  const root = await mkdtemp(path.join(tmpdir(), "athena-portable-batch-rollback-"));
  const unrelatedPath = path.join(root, "unrelated.txt");
  const unrelatedBytes = "unrelated dirty work remains byte-identical\n";
  try {
    await Promise.all([
      mkdir(path.join(root, ".agents/skills"), { recursive: true }),
      mkdir(path.join(root, ".claude/skills"), { recursive: true }),
      cp(
        path.join(rootDir, ".agent-skills/current/skills"),
        path.join(root, ".agent-skills/current/skills"),
        { recursive: true, verbatimSymlinks: true },
      ),
      cp(
        path.join(rootDir, PREDECESSOR_PATH),
        path.join(root, PREDECESSOR_PATH),
        { recursive: true },
      ),
      writeFile(unrelatedPath, unrelatedBytes),
    ]);
    await Promise.all(
      Object.keys(WORKFLOW_SHA256).flatMap((workflow) =>
        ([".agents/skills", ".claude/skills"] as const).map((host) =>
          symlink(
            `../../.agent-skills/current/skills/${workflow}`,
            path.join(root, host, workflow),
          ),
        ),
      ),
    );

    await rm(path.join(root, ".agent-skills/current"), {
      recursive: true,
      force: true,
    });

    await Promise.all([
      unlink(path.join(root, ".agents/skills/deliver-work")),
      unlink(path.join(root, ".claude/skills/deliver-work")),
    ]);
    await cp(
      path.join(root, PREDECESSOR_PATH, "deliver-work"),
      path.join(root, ".agents/skills/deliver-work"),
      { recursive: true },
    );
    const restoredFiles = await Promise.all(
      PREDECESSOR_FILES.map(async (entry) => ({
        path: entry.path,
        sha256: sha256(
          await readFile(path.join(root, ".agents/skills/deliver-work", entry.path)),
        ),
      })),
    );
    const entrypointRestored =
      sha256(JSON.stringify(restoredFiles)) === PREDECESSOR_SHA256 &&
      (await pathAbsent(path.join(root, ".claude/skills/deliver-work")));

    await Promise.all(
      PRIMITIVE_WORKFLOWS.flatMap((workflow) =>
        ([".agents/skills", ".claude/skills"] as const).map((host) =>
          unlink(path.join(root, host, workflow)),
        ),
      ),
    );
    const primitivesRemoved = (
      await Promise.all(
        PRIMITIVE_WORKFLOWS.flatMap((workflow) =>
          ([".agents/skills", ".claude/skills"] as const).map((host) =>
            pathAbsent(path.join(root, host, workflow)),
          ),
        ),
      )
    ).every(Boolean);
    const unrelatedAfter = await readFile(unrelatedPath, "utf8");
    return {
      restoredBatches:
        entrypointRestored && primitivesRemoved
          ? ["delivery-entrypoint", "workflow-primitives"]
          : [],
      sourceIndependent: true,
      unrelatedBytesPreserved: unrelatedAfter === unrelatedBytes,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const rootDir = path.resolve(process.argv[2] ?? ".");
  const audit = await auditPortableBatchAdoption(rootDir);
  const rollback = audit.ok
    ? await rehearsePortableBatchRollback(rootDir)
    : {
        restoredBatches: [],
        sourceIndependent: false,
        unrelatedBytesPreserved: false,
      };
  console.log(audit.summary);
  for (const finding of audit.findings) {
    console.error(`${finding.code}: ${finding.message}`);
  }
  console.log(
    `[portable-batches] Rollback rehearsal: restored=${rollback.restoredBatches.join(",") || "none"}; source-independent=${rollback.sourceIndependent}; unrelated-bytes-preserved=${rollback.unrelatedBytesPreserved}.`,
  );
  if (
    !audit.ok ||
    rollback.restoredBatches.length !== 2 ||
    !rollback.sourceIndependent ||
    !rollback.unrelatedBytesPreserved
  ) {
    process.exitCode = 1;
  }
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  await main();
}

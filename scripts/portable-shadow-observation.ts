import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DEFAULT_DELIVERY_RUN_LATEST_PATH,
  readDeliveryRunLedger,
} from "./harness-delivery-run-ledger";
import {
  collectChangedPathsForDiff,
  collectDeliverableDiffFingerprint,
} from "./delivery-diff-fingerprint";

const WORKFLOW = "compound-delivery-kernel" as const;
const RELEASE_ID = "core-v1" as const;
const RELEASE_PROFILE = "core" as const;
const SOURCE_COMMIT_SHA = "f0a058d7b40a38bbe43c007f8b11248ecd4bda6a";
const ARCHIVE_SHA256 =
  "f8b39590bae786767cff1cfd849382884a0b66f12ef9978f752dbcb28c230f26";
const METADATA_SHA256 =
  "cd0094de0eba4077e05af0c12e10b2a692d93e30e58b7d6aa8495cb0a53899fe";
const SOURCE_WORKFLOW_SHA256 =
  "d7a651c9392a36f923784771f24a532acca81fa223b865be46cba842c061e706";
const SOURCE_INPUT_SHA256 =
  "54b1e4afe4731d335afaf47602dbf6ae4089f9a1d0e36af7939d39c054dda22b";
const BASELINE_ID = "athena-portable-workflows-v1-2026-08-27";
const BASELINE_SHA256 =
  "d0f66ad0a48745d86f8cdb4d7c76bf4a644f074cfa7b5dfebcfbf5ccf9b09613";
const DEFAULT_INPUT_PATH =
  "scripts/portable-shadow-fixtures/compound-delivery-kernel.json";
const DEFAULT_BASELINE_PATH = ".agents/characterization-baseline.json";
const DEFAULT_ARCHIVE_PATH = ".agents/portable/releases/core-v1.zip";
const DEFAULT_METADATA_PATH = ".agents/portable/releases/core-v1.release.json";
export const DEFAULT_PORTABLE_SHADOW_PATH =
  "artifacts/harness-delivery-runs/shadow-comparison.json";

export type PortableShadowDecisions = {
  routing: { entryPoint: string; workflow: string };
  posture: string;
  gate: { status: string; blockers: string[] };
  evidence: string[];
};

export type PortableShadowComparison = {
  schemaVersion: "athena-portable-shadow-comparison/1";
  observedAt: string;
  workflow: "compound-delivery-kernel";
  inputSha256: string;
  candidateFingerprint: string;
  comparisonSha256: string;
  status: "match" | "mismatch" | "unavailable";
  baseline: {
    baselineId: string;
    sha256: string;
  };
  source: {
    releaseId: string;
    profile: string;
    sourceCommitSha: string;
    archiveSha256: string;
    metadataSha256: string;
    workflowSha256: string;
  };
  athena: PortableShadowDecisions;
  portable?: PortableShadowDecisions;
  portableMutationAttempts: string[];
  mismatches: Array<{
    field: string;
    athena: unknown;
    portable: unknown;
    disposition: "unresolved";
  }>;
  unavailableReason?: string;
  authority: {
    authoritativePath: "athena";
    influencedAuthoritativeResult: false;
    authoritySwitchAllowed: false;
    portableCapabilities: {
      trackerMutation: false;
      merge: false;
      deploy: false;
      statusMutation: false;
    };
  };
};

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function hasOnlyKeys(value: unknown, allowedKeys: readonly string[]) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowedKeys.includes(key))
  );
}

function decisions(value: unknown): value is PortableShadowDecisions {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PortableShadowDecisions>;
  return (
    hasOnlyKeys(candidate, ["routing", "posture", "gate", "evidence"]) &&
    Boolean(candidate.routing) &&
    hasOnlyKeys(candidate.routing, ["entryPoint", "workflow"]) &&
    typeof candidate.routing?.entryPoint === "string" &&
    typeof candidate.routing.workflow === "string" &&
    typeof candidate.posture === "string" &&
    Boolean(candidate.gate) &&
    hasOnlyKeys(candidate.gate, ["status", "blockers"]) &&
    typeof candidate.gate?.status === "string" &&
    stringArray(candidate.gate.blockers) &&
    stringArray(candidate.evidence)
  );
}

export function isPortableShadowComparison(
  value: unknown,
): value is PortableShadowComparison {
  if (!isPortableShadowComparisonRecord(value)) return false;
  return (
    value.inputSha256 === SOURCE_INPUT_SHA256 &&
    value.baseline.baselineId === BASELINE_ID &&
    value.baseline.sha256 === BASELINE_SHA256 &&
    value.source.releaseId === RELEASE_ID &&
    value.source.profile === RELEASE_PROFILE &&
    value.source.sourceCommitSha === SOURCE_COMMIT_SHA &&
    value.source.archiveSha256 === ARCHIVE_SHA256 &&
    value.source.metadataSha256 === METADATA_SHA256 &&
    value.source.workflowSha256 === SOURCE_WORKFLOW_SHA256
  );
}

export function isPortableShadowComparisonRecord(
  value: unknown,
): value is PortableShadowComparison {
  if (
    !hasOnlyKeys(value, [
      "schemaVersion",
      "observedAt",
      "workflow",
      "inputSha256",
      "candidateFingerprint",
      "comparisonSha256",
      "status",
      "baseline",
      "source",
      "athena",
      "portable",
      "portableMutationAttempts",
      "mismatches",
      "unavailableReason",
      "authority",
    ])
  ) {
    return false;
  }
  const comparison = value as Partial<PortableShadowComparison>;
  const digest = /^[0-9a-f]{64}$/;
  const commit = /^[0-9a-f]{40}$/;
  const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
  const expectedMismatches = recomputeMismatches(comparison);
  return (
    comparison.schemaVersion === "athena-portable-shadow-comparison/1" &&
    typeof comparison.observedAt === "string" &&
    isoTimestamp.test(comparison.observedAt) &&
    comparison.workflow === WORKFLOW &&
    typeof comparison.inputSha256 === "string" &&
    digest.test(comparison.inputSha256) &&
    typeof comparison.candidateFingerprint === "string" &&
    digest.test(comparison.candidateFingerprint) &&
    typeof comparison.comparisonSha256 === "string" &&
    digest.test(comparison.comparisonSha256) &&
    comparison.comparisonSha256 ===
      portableShadowComparisonSha256(comparison as PortableShadowComparison) &&
    ["match", "mismatch", "unavailable"].includes(comparison.status ?? "") &&
    hasOnlyKeys(comparison.baseline, ["baselineId", "sha256"]) &&
    typeof comparison.baseline?.baselineId === "string" &&
    comparison.baseline.baselineId.length > 0 &&
    typeof comparison.baseline.sha256 === "string" &&
    digest.test(comparison.baseline.sha256) &&
    hasOnlyKeys(comparison.source, [
      "releaseId",
      "profile",
      "sourceCommitSha",
      "archiveSha256",
      "metadataSha256",
      "workflowSha256",
    ]) &&
    typeof comparison.source?.releaseId === "string" &&
    comparison.source.releaseId.length > 0 &&
    typeof comparison.source.profile === "string" &&
    comparison.source.profile.length > 0 &&
    typeof comparison.source.sourceCommitSha === "string" &&
    commit.test(comparison.source.sourceCommitSha) &&
    typeof comparison.source.archiveSha256 === "string" &&
    digest.test(comparison.source.archiveSha256) &&
    typeof comparison.source.metadataSha256 === "string" &&
    digest.test(comparison.source.metadataSha256) &&
    typeof comparison.source.workflowSha256 === "string" &&
    digest.test(comparison.source.workflowSha256) &&
    decisions(comparison.athena) &&
    (comparison.portable === undefined || decisions(comparison.portable)) &&
    stringArray(comparison.portableMutationAttempts) &&
    Array.isArray(comparison.mismatches) &&
    comparison.mismatches.every(
      (mismatch) =>
        mismatch &&
        typeof mismatch === "object" &&
        hasOnlyKeys(mismatch, ["field", "athena", "portable", "disposition"]) &&
        typeof mismatch.field === "string" &&
        mismatch.disposition === "unresolved",
    ) &&
    expectedMismatches !== null &&
    semanticJson(comparison.mismatches) === semanticJson(expectedMismatches) &&
    hasOnlyKeys(comparison.authority, [
      "authoritativePath",
      "influencedAuthoritativeResult",
      "authoritySwitchAllowed",
      "portableCapabilities",
    ]) &&
    comparison.authority?.authoritativePath === "athena" &&
    comparison.authority.influencedAuthoritativeResult === false &&
    comparison.authority.authoritySwitchAllowed === false &&
    hasOnlyKeys(comparison.authority.portableCapabilities, [
      "trackerMutation",
      "merge",
      "deploy",
      "statusMutation",
    ]) &&
    comparison.authority.portableCapabilities.trackerMutation === false &&
    comparison.authority.portableCapabilities.merge === false &&
    comparison.authority.portableCapabilities.deploy === false &&
    comparison.authority.portableCapabilities.statusMutation === false &&
    (comparison.status !== "match" ||
      (comparison.portable !== undefined &&
        comparison.mismatches.length === 0)) &&
    (comparison.status !== "mismatch" ||
      (comparison.portable !== undefined &&
        comparison.mismatches.length > 0)) &&
    (comparison.status !== "unavailable" ||
      (comparison.portable === undefined &&
        comparison.portableMutationAttempts.length === 0 &&
        comparison.mismatches.length === 0 &&
        typeof comparison.unavailableReason === "string" &&
        comparison.unavailableReason.length > 0))
  );
}

function recomputeMismatches(
  comparison: Partial<PortableShadowComparison>,
): PortableShadowComparison["mismatches"] | null {
  if (
    !decisions(comparison.athena) ||
    !stringArray(comparison.portableMutationAttempts)
  ) {
    return null;
  }
  if (comparison.portable === undefined) return [];
  if (!decisions(comparison.portable)) return null;
  const mismatches = comparedFields(comparison.athena, comparison.portable);
  if (comparison.portableMutationAttempts.length > 0) {
    mismatches.push({
      field: "authority.mutationAttempts",
      athena: [],
      portable: comparison.portableMutationAttempts,
      disposition: "unresolved",
    });
  }
  return mismatches;
}

export function portableShadowComparisonSha256(
  comparison:
    | PortableShadowComparison
    | Omit<PortableShadowComparison, "comparisonSha256">,
) {
  return sha256(
    semanticJson({
      schemaVersion: comparison.schemaVersion,
      observedAt: comparison.observedAt,
      workflow: comparison.workflow,
      inputSha256: comparison.inputSha256,
      candidateFingerprint: comparison.candidateFingerprint,
      status: comparison.status,
      baseline: comparison.baseline,
      source: comparison.source,
      athena: comparison.athena,
      ...(comparison.portable ? { portable: comparison.portable } : {}),
      portableMutationAttempts: comparison.portableMutationAttempts,
      mismatches: comparison.mismatches,
      ...(comparison.unavailableReason
        ? { unavailableReason: comparison.unavailableReason }
        : {}),
      authority: comparison.authority,
    }),
  );
}

export async function readPortableShadowComparison(
  rootDir: string,
  shadowPath = DEFAULT_PORTABLE_SHADOW_PATH,
) {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(rootDir, shadowPath), "utf8"),
    );
    if (!isPortableShadowComparison(parsed)) {
      throw new Error("portable shadow artifact is malformed");
    }
    return parsed;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

type PortableShadowInput = {
  schemaVersion: "athena-portable-shadow-input/1";
  workflow: typeof WORKFLOW;
  request: {
    intent: string;
    outcome: string;
    scope: string[];
    finishLine: string[];
    testScenarios: string[];
    existingBehavior: boolean;
    behaviorChange: boolean;
    repositorySensors: Array<{
      name: string;
      required: boolean;
      available: boolean;
      passed: boolean;
    }>;
    completedWork: string[];
    completedFinishLine: string[];
    evidence: string[];
  };
};

type PortableEvaluation = {
  decisions: PortableShadowDecisions;
  mutationAttempts: string[];
};

export type PortableShadowEvaluator = (
  input: PortableShadowInput,
  context: { archivePath: string; metadataPath: string },
) => Promise<PortableEvaluation>;

type ObservationOptions = {
  observedAt?: string;
  candidateFingerprint: string;
  inputPath?: string;
  baselinePath?: string;
  archivePath?: string;
  metadataPath?: string;
  evaluator?: PortableShadowEvaluator;
};

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function nonEmptyStrings(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    throw new Error(`${field} must be a non-empty string array`);
  }
  return value;
}

function parseInput(contents: string): PortableShadowInput {
  const value = JSON.parse(contents) as Partial<PortableShadowInput>;
  const request = value.request as PortableShadowInput["request"] | undefined;
  if (
    value.schemaVersion !== "athena-portable-shadow-input/1" ||
    value.workflow !== WORKFLOW ||
    !request ||
    typeof request.intent !== "string" ||
    typeof request.outcome !== "string" ||
    typeof request.existingBehavior !== "boolean" ||
    typeof request.behaviorChange !== "boolean"
  ) {
    throw new Error("portable shadow input is malformed");
  }
  nonEmptyStrings(request.scope, "request.scope");
  nonEmptyStrings(request.finishLine, "request.finishLine");
  nonEmptyStrings(request.testScenarios, "request.testScenarios");
  nonEmptyStrings(request.completedWork, "request.completedWork");
  nonEmptyStrings(request.completedFinishLine, "request.completedFinishLine");
  nonEmptyStrings(request.evidence, "request.evidence");
  if (
    !Array.isArray(request.repositorySensors) ||
    request.repositorySensors.length === 0 ||
    !request.repositorySensors.every(
      (sensor) =>
        sensor &&
        typeof sensor.name === "string" &&
        sensor.name.length > 0 &&
        typeof sensor.required === "boolean" &&
        typeof sensor.available === "boolean" &&
        typeof sensor.passed === "boolean",
    )
  ) {
    throw new Error("request.repositorySensors is malformed");
  }
  return value as PortableShadowInput;
}

function evaluateAthenaBaseline(
  input: PortableShadowInput,
  baselineContents: string,
): PortableShadowDecisions {
  const baseline = JSON.parse(baselineContents) as {
    schemaVersion?: string;
    baselineId?: string;
    readOnly?: boolean;
    assertions?: Array<{ id?: string }>;
  };
  const requiredAssertions = [
    "route-default-implementation-through-deliver-work",
    "implementation-selects-explicit-test-posture",
    "smallest-honest-sensors-run-before-merge-gate",
    "pr-athena-remains-merge-ready-authority",
    "athena-review-evidence-binds-the-candidate",
  ];
  const assertionIds = new Set(
    (baseline.assertions ?? []).map((assertion) => assertion.id),
  );
  if (
    baseline.schemaVersion !== "athena-portable-characterization-baseline/1" ||
    baseline.baselineId !== BASELINE_ID ||
    baseline.readOnly !== true ||
    requiredAssertions.some((assertion) => !assertionIds.has(assertion))
  ) {
    throw new Error("Athena characterization baseline is unavailable");
  }

  const blockers = input.request.repositorySensors
    .filter(
      (sensor) => sensor.required && (!sensor.available || !sensor.passed),
    )
    .map((sensor) =>
      sensor.available
        ? `required sensor failed: ${sensor.name}`
        : `required sensor unavailable: ${sensor.name}`,
    );
  return {
    routing: { entryPoint: "deliver-work", workflow: "implement" },
    posture: input.request.existingBehavior
      ? "characterization-first"
      : input.request.behaviorChange
        ? "test-first"
        : "sensor-only",
    gate: {
      status: blockers.length > 0 ? "blocked" : "complete",
      blockers,
    },
    evidence: [...input.request.evidence],
  };
}

const PORTABLE_DRIVER = String.raw`
import hashlib
import json
import pathlib
import sys

archive = pathlib.Path(sys.argv[1])
metadata = pathlib.Path(sys.argv[2])
extracted = pathlib.Path(sys.argv[3])
sys.path.insert(0, str(archive))
from agent_skills.release import verify_release
verified = verify_release(archive, metadata, extract_to=extracted)
for name in tuple(sys.modules):
    if name == "agent_skills" or name.startswith("agent_skills."):
        del sys.modules[name]
sys.path = [entry for entry in sys.path if entry != str(archive)]
sys.path.insert(0, str(extracted))
from agent_skills.router import WorkflowRequest, route_workflow
from agent_skills.workflows import ExecutionRequest, PlanningRequest, Sensor, execute_work, plan_work

payload = json.load(sys.stdin)
request = payload["request"]
route = route_workflow(WorkflowRequest(intent=request["intent"]))
sensors = tuple(
    Sensor(sensor["name"], sensor["required"], sensor["available"])
    for sensor in request["repositorySensors"]
)
plan = plan_work(PlanningRequest(
    outcome=request["outcome"],
    scope=tuple(request["scope"]),
    finish_line=tuple(request["finishLine"]),
    test_scenarios=tuple(request["testScenarios"]),
    repository_sensors=sensors,
    existing_behavior=request["existingBehavior"],
    behavior_change=request["behaviorChange"],
    tracking_selected=False,
))
execution = execute_work(ExecutionRequest(
    plan=plan,
    completed_work=tuple(request["completedWork"]),
    completed_finish_line=tuple(request["completedFinishLine"]),
    sensor_results={sensor["name"]: sensor["passed"] for sensor in request["repositorySensors"]},
    evidence=tuple(request["evidence"]),
    tracking_selected=False,
))
print(json.dumps({
    "decisions": {
        "routing": {"entryPoint": route.entry_point, "workflow": route.workflow.value},
        "posture": plan.posture,
        "gate": {"status": execution.status, "blockers": list(execution.blockers)},
        "evidence": list(execution.evidence),
    },
    "mutationAttempts": [
        *(outcome.operation.value for outcome in plan.tracker_outcomes),
        *(outcome.operation.value for outcome in execution.tracker_outcomes),
    ],
    "release": {
        "releaseId": verified.release_id,
        "profile": verified.profile_id,
        "archiveSha256": verified.archive_sha256,
        "metadataSha256": verified.metadata_sha256,
        "workflowSha256": hashlib.sha256((extracted / "skills/compound-delivery-kernel/SKILL.md").read_bytes()).hexdigest(),
    },
}, sort_keys=True, separators=(",", ":")))
`;

async function evaluateExactPortableRelease(
  input: PortableShadowInput,
  context: { archivePath: string; metadataPath: string },
): Promise<PortableEvaluation> {
  const [archiveBytes, metadataBytes] = await Promise.all([
    readFile(context.archivePath),
    readFile(context.metadataPath),
  ]);
  if (
    sha256(archiveBytes) !== ARCHIVE_SHA256 ||
    sha256(metadataBytes) !== METADATA_SHA256
  ) {
    throw new Error(
      "exact portable release digest does not match qualification",
    );
  }
  const metadata = JSON.parse(metadataBytes.toString("utf8")) as Record<
    string,
    unknown
  >;
  if (
    metadata.schemaVersion !== "agent-skills-release-metadata/1" ||
    metadata.releaseId !== RELEASE_ID ||
    metadata.profile !== RELEASE_PROFILE ||
    metadata.archiveSha256 !== ARCHIVE_SHA256
  ) {
    throw new Error("exact portable release metadata is malformed");
  }

  const isolatedRoot = await mkdtemp(
    path.join(tmpdir(), "athena-shadow-core-"),
  );
  try {
    const isolatedArchive = path.join(isolatedRoot, "core-v1.zip");
    const isolatedMetadata = path.join(isolatedRoot, "core-v1.release.json");
    const extracted = path.join(isolatedRoot, "extracted");
    await Promise.all([
      copyFile(context.archivePath, isolatedArchive),
      copyFile(context.metadataPath, isolatedMetadata),
    ]);
    const process = Bun.spawn(
      [
        "python3",
        "-c",
        PORTABLE_DRIVER,
        isolatedArchive,
        isolatedMetadata,
        extracted,
      ],
      {
        cwd: isolatedRoot,
        env: {
          PATH: processEnvPath(),
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONNOUSERSITE: "1",
        },
        stdin: new Blob([JSON.stringify(input)]),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `exact portable release evaluation failed: ${stderr.trim() || "unknown error"}`,
      );
    }
    const output = JSON.parse(stdout) as PortableEvaluation & {
      release?: Record<string, unknown>;
    };
    if (
      output.release?.releaseId !== RELEASE_ID ||
      output.release.profile !== RELEASE_PROFILE ||
      output.release.archiveSha256 !== ARCHIVE_SHA256 ||
      output.release.metadataSha256 !== METADATA_SHA256 ||
      output.release.workflowSha256 !== SOURCE_WORKFLOW_SHA256 ||
      !output.decisions ||
      !Array.isArray(output.mutationAttempts)
    ) {
      throw new Error("exact portable release returned malformed output");
    }
    return {
      decisions: output.decisions,
      mutationAttempts: output.mutationAttempts,
    };
  } finally {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
}

function processEnvPath() {
  return process.env.PATH ?? "/usr/bin:/bin";
}

function comparedFields(
  athena: PortableShadowDecisions,
  portable: PortableShadowDecisions,
): PortableShadowComparison["mismatches"] {
  const fields = ["routing", "posture", "gate", "evidence"] as const;
  return fields.flatMap((field) =>
    semanticJson(athena[field]) === semanticJson(portable[field])
      ? []
      : [
          {
            field,
            athena: athena[field],
            portable: portable[field],
            disposition: "unresolved" as const,
          },
        ],
  );
}

function semanticJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(semanticJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${semanticJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function authorityBoundary(): PortableShadowComparison["authority"] {
  return {
    authoritativePath: "athena",
    influencedAuthoritativeResult: false,
    authoritySwitchAllowed: false,
    portableCapabilities: {
      trackerMutation: false,
      merge: false,
      deploy: false,
      statusMutation: false,
    },
  };
}

export async function observePortableShadow(
  rootDir: string,
  options: ObservationOptions,
): Promise<PortableShadowComparison> {
  const inputPath = options.inputPath ?? path.join(rootDir, DEFAULT_INPUT_PATH);
  const baselinePath =
    options.baselinePath ?? path.join(rootDir, DEFAULT_BASELINE_PATH);
  const archivePath =
    options.archivePath ?? path.join(rootDir, DEFAULT_ARCHIVE_PATH);
  const metadataPath =
    options.metadataPath ?? path.join(rootDir, DEFAULT_METADATA_PATH);
  const [inputContents, baselineContents] = await Promise.all([
    readFile(inputPath, "utf8"),
    readFile(baselinePath, "utf8"),
  ]);
  const input = parseInput(inputContents);
  if (sha256(inputContents) !== SOURCE_INPUT_SHA256) {
    throw new Error(
      "portable shadow input digest does not match qualification",
    );
  }
  const athena = evaluateAthenaBaseline(input, baselineContents);
  if (sha256(baselineContents) !== BASELINE_SHA256) {
    throw new Error(
      "Athena characterization baseline digest does not match V26-1413",
    );
  }
  const common = {
    schemaVersion: "athena-portable-shadow-comparison/1" as const,
    observedAt: options.observedAt ?? new Date().toISOString(),
    workflow: WORKFLOW,
    inputSha256: sha256(inputContents),
    candidateFingerprint: options.candidateFingerprint,
    baseline: {
      baselineId: BASELINE_ID,
      sha256: BASELINE_SHA256,
    } as const,
    source: {
      releaseId: RELEASE_ID,
      profile: RELEASE_PROFILE,
      sourceCommitSha: SOURCE_COMMIT_SHA,
      archiveSha256: ARCHIVE_SHA256,
      metadataSha256: METADATA_SHA256,
      workflowSha256: SOURCE_WORKFLOW_SHA256,
    },
    athena,
    authority: authorityBoundary(),
  };

  try {
    const portableResult = await (
      options.evaluator ?? evaluateExactPortableRelease
    )(input, { archivePath, metadataPath });
    const mismatches = comparedFields(athena, portableResult.decisions);
    if (portableResult.mutationAttempts.length > 0) {
      mismatches.push({
        field: "authority.mutationAttempts",
        athena: [],
        portable: portableResult.mutationAttempts,
        disposition: "unresolved",
      });
    }
    return withComparisonSha({
      ...common,
      status: mismatches.length === 0 ? "match" : "mismatch",
      portable: portableResult.decisions,
      portableMutationAttempts: portableResult.mutationAttempts,
      mismatches,
    });
  } catch (error) {
    return withComparisonSha({
      ...common,
      status: "unavailable",
      portableMutationAttempts: [],
      mismatches: [],
      unavailableReason: `exact portable release unavailable: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    });
  }
}

function withComparisonSha(
  comparison: Omit<PortableShadowComparison, "comparisonSha256">,
): PortableShadowComparison {
  return {
    ...comparison,
    comparisonSha256: portableShadowComparisonSha256(comparison),
  };
}

export async function runPortableShadowObservation(
  rootDir: string,
  options: Omit<ObservationOptions, "candidateFingerprint"> & {
    baseRef?: string;
    ledgerPath?: string;
    shadowPath?: string;
  } = {},
) {
  const ledgerPath = options.ledgerPath ?? DEFAULT_DELIVERY_RUN_LATEST_PATH;
  const shadowPath = options.shadowPath ?? DEFAULT_PORTABLE_SHADOW_PATH;
  const ledger = await readDeliveryRunLedger(rootDir, ledgerPath);
  if (
    !ledger ||
    ledger.status !== "pass" ||
    !ledger.deliverableDiffFingerprint
  ) {
    throw new Error(
      "Portable shadow observation refused: the authoritative gate has not passed.",
    );
  }
  const baseRef =
    options.baseRef ??
    ledger.gateDecisionEvents.at(-1)?.baseRef ??
    "origin/main";
  const currentFingerprint = collectDeliverableDiffFingerprint(
    rootDir,
    baseRef,
    collectChangedPathsForDiff(rootDir, baseRef),
  );
  if (currentFingerprint !== ledger.deliverableDiffFingerprint) {
    throw new Error(
      "Portable shadow observation refused: the authoritative gate describes a different deliverable.",
    );
  }
  const {
    baseRef: _baseRef,
    ledgerPath: _ledgerPath,
    shadowPath: _shadowPath,
    ...observationOptions
  } = options;
  const comparison = await observePortableShadow(rootDir, {
    ...observationOptions,
    candidateFingerprint: ledger.deliverableDiffFingerprint,
  });
  const absoluteShadowPath = path.join(rootDir, shadowPath);
  await mkdir(path.dirname(absoluteShadowPath), { recursive: true });
  await writeFile(
    absoluteShadowPath,
    `${JSON.stringify(comparison, null, 2)}\n`,
    "utf8",
  );
  return comparison;
}

if (import.meta.main) {
  const comparison = await runPortableShadowObservation(process.cwd());
  console.log(JSON.stringify(comparison));
}

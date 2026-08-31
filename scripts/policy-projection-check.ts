import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD,
} from "./delivery-run-telemetry";
import { HARNESS_GATE_REGISTRY } from "./harness-gate-registry";
import {
  selectMechanicalCommands,
  type MechanicalCommand,
} from "./harness-mechanical-check";
import { AGENT_SDK_GENERATED_ARTIFACTS } from "./agent-sdk-generate";
import { TRACKED_GRAPHIFY_ARTIFACTS } from "./graphify-check";

/**
 * Read-only comparison between Athena's layered policy projection under
 * `.agents/policy/` and the unchanged legacy delivery authority.
 *
 * The projection is a mapping, not a cutover: `bun run pr:athena` stays the
 * comparison authority, and this sensor only proves that the declarative
 * document, the typed leaf adapters, the recorded compiled snapshot, and the
 * frozen pre-cutover oracle still describe the routing the repository actually
 * runs. Every defect is a typed finding; nothing here mutates state.
 *
 * The oracle is immutable by digest: `PRE_CUTOVER_ORACLE_DIGEST` pins its
 * exact bytes, so recharacterizing the pre-cutover truth is a deliberate
 * two-place edit instead of a quiet drift.
 */
export const POLICY_PROJECTION_DIR = ".agents/policy";

export const PRE_CUTOVER_ORACLE_DIGEST =
  "76b3e7d79294ff910984435609e44c7fc80f0d52e7f1d2b9419df28488d29564";

const DOCUMENT_FILE = "repository-policy.json";
const ADAPTERS_FILE = "adapters.json";
const ORACLE_FILE = "pre-cutover-oracle.json";
const SNAPSHOT_FILE = "compiled-snapshot.json";
const REPORT_FILE = "comparison-report.json";

const ADJUDICATION_DISPOSITIONS = new Set([
  "accepted-projection",
  "deferred",
  "recorded",
  "corrected",
]);

/** The generated trees model-driven stages must never own by hand. */
const PROTECTED_GENERATED_TREES = [
  "graphify-out",
  "packages/athena-webapp/convex/_generated",
  "packages/athena-webapp/convex/agentHarness/_generated",
];

export type PolicyProjectionFinding = {
  code:
    | "artifact_unreadable"
    | "oracle_digest_mismatch"
    | "snapshot_input_stale"
    | "report_input_stale"
    | "phase_drift"
    | "obligation_drift"
    | "authority_drift"
    | "lens_persona_defect"
    | "leaf_mapping_defect"
    | "aggregate_registered_as_leaf"
    | "mechanical_activation_drift"
    | "generated_ownership_drift"
    | "adjudication_incomplete";
  message: string;
};

export type PolicyProjectionCheckResult = {
  status: "pass" | "fail";
  findings: PolicyProjectionFinding[];
};

type PolicyProjectionOptions = {
  policyDir?: string;
};

export function formatMechanicalSelection(commands: MechanicalCommand[]) {
  return commands.map((command) =>
    command.kind === "script"
      ? `${command.packageDir} ${command.script}`
      : command.command,
  );
}

function sha256(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function equalStringArrays(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function coveredByProtectedTree(artifactPath: string) {
  return PROTECTED_GENERATED_TREES.some(
    (tree) => artifactPath === tree || artifactPath.startsWith(`${tree}/`),
  );
}

export async function runPolicyProjectionCheck(
  rootDir: string,
  options: PolicyProjectionOptions = {},
): Promise<PolicyProjectionCheckResult> {
  const findings: PolicyProjectionFinding[] = [];
  const emit = (code: PolicyProjectionFinding["code"], message: string) => {
    findings.push({ code, message });
  };
  const policyDir = options.policyDir ?? path.join(rootDir, POLICY_PROJECTION_DIR);

  const bytes = new Map<string, Buffer>();
  const parsed = new Map<string, unknown>();
  for (const file of [DOCUMENT_FILE, ADAPTERS_FILE, ORACLE_FILE, SNAPSHOT_FILE, REPORT_FILE]) {
    try {
      const content = await readFile(path.join(policyDir, file));
      bytes.set(file, content);
      parsed.set(file, JSON.parse(content.toString("utf8")));
    } catch (error) {
      emit(
        "artifact_unreadable",
        `${POLICY_PROJECTION_DIR}/${file} is missing or not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (findings.length > 0) return { status: "fail", findings };

  const document = parsed.get(DOCUMENT_FILE) as {
    grantedFinishLines: string[];
    grantedAuthority: string[];
    forbiddenAuthority: string[];
    reviewLenses: {
      lensId: string;
      category: string;
      personaId?: string;
      personaDigest?: string;
    }[];
    obligations: { obligationId: string }[];
    requiredCapabilities: { capabilityId: string; kind: string; version: string }[];
    checkpoints?: { stageId: string; additionalProtectedPaths: string[] }[];
  };
  const adapters = parsed.get(ADAPTERS_FILE) as {
    capabilityId: string;
    kind: string;
    version: string;
  }[];
  const oracle = parsed.get(ORACLE_FILE) as {
    phaseVector: { orderedPhases: { phase: string; command: string }[] };
    activationVector: {
      obligations: Record<
        string,
        {
          activation: string;
          minimumRelevantChangedLines?: number;
          sensitiveScenarioCount?: number;
          relevantBinaryChangeActivates?: boolean;
          blockingThresholdSourceLines?: number;
          freshness: string;
          providerPolicy: string;
          providers: string[];
          ciDelegation: string[];
        }
      >;
      mechanicalSelection: Record<string, string[]>;
      mechanicalSelectionProbes: Record<string, string[]>;
    };
    leafMappings: { leaf: string; capabilityId: string; kind: string }[];
    aggregateExclusions: { entrypoint: string }[];
    generatedArtifactOwnership: {
      repairStage: string;
      groups: { id: string; paths?: string[] }[];
    };
  };
  const snapshot = parsed.get(SNAPSHOT_FILE) as {
    inputDigests: Record<string, string>;
    compiled: {
      compiledDigest: string;
      snapshot: {
        grantedFinishLines: string[];
        grantedAuthority: string[];
        obligations: { obligationId: string }[];
        reviewLenses: {
          lensId: string;
          category: string;
          personaId?: string;
          personaDigest?: string;
        }[];
      };
      capabilities: { capabilityId: string }[];
      checkpointGrants: { stageId: string; grant: { protectedPaths: string[] } }[];
    };
  };
  const report = parsed.get(REPORT_FILE) as {
    inputs: Record<string, string>;
    adjudications: { id?: string; disposition?: string; blocking?: boolean }[];
  };

  // Valid JSON with the wrong shape must land as a typed finding, not an
  // unhandled throw that discards the findings already collected.
  try {

  // -- Oracle immutability ---------------------------------------------------
  const oracleDigest = sha256(bytes.get(ORACLE_FILE)!);
  if (oracleDigest !== PRE_CUTOVER_ORACLE_DIGEST) {
    emit(
      "oracle_digest_mismatch",
      `${ORACLE_FILE} digest ${oracleDigest} does not match the pinned pre-cutover digest; the oracle is immutable and recharacterization is a deliberate two-place edit`,
    );
  }

  // -- Recorded artifacts must describe the current inputs -------------------
  const documentDigest = sha256(bytes.get(DOCUMENT_FILE)!);
  const adaptersDigest = sha256(bytes.get(ADAPTERS_FILE)!);
  if (
    snapshot.inputDigests[DOCUMENT_FILE] !== documentDigest ||
    snapshot.inputDigests[ADAPTERS_FILE] !== adaptersDigest
  ) {
    emit(
      "snapshot_input_stale",
      "the recorded compiled snapshot was not compiled from the current document and adapter bytes; recompile through the harness policy compiler and re-record",
    );
  }
  // The snapshot's own bytes are pinned through the report: hand-editing the
  // recorded compile output without re-recording the comparison is a stale
  // report, not a quieter snapshot.
  const snapshotFileDigest = sha256(bytes.get(SNAPSHOT_FILE)!);
  if (
    report.inputs[DOCUMENT_FILE] !== documentDigest ||
    report.inputs[ADAPTERS_FILE] !== adaptersDigest ||
    report.inputs[ORACLE_FILE] !== oracleDigest ||
    report.inputs[SNAPSHOT_FILE] !== snapshotFileDigest ||
    report.inputs["compiledDigest"] !== snapshot.compiled.compiledDigest
  ) {
    emit(
      "report_input_stale",
      "the comparison report does not describe the current policy artifacts; re-run the comparison and re-record it",
    );
  }

  // -- Phase parity against the live aggregate -------------------------------
  const manifest = JSON.parse(
    await readFile(path.join(rootDir, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const scripts = manifest.scripts ?? {};
  for (const entry of oracle.phaseVector.orderedPhases) {
    const scriptName = entry.command.replace(/^bun run /, "");
    if (!scripts[scriptName]) {
      emit(
        "phase_drift",
        `oracle phase ${entry.phase} names ${scriptName}, which package.json no longer defines`,
      );
    }
  }
  const deliveryRunSource = await readFile(
    path.join(rootDir, "scripts", "pr-athena-delivery-run.ts"),
    "utf8",
  );
  const phasesLiteral = deliveryRunSource.match(
    /const PR_ATHENA_PHASES[^=]*=\s*\[([\s\S]*?)\];/,
  );
  const livePhaseEntries = phasesLiteral
    ? [
        ...phasesLiteral[1].matchAll(
          /phase:\s*"([a-z-]+)",\s*command:\s*\[([^\]]*)\]/g,
        ),
      ].map((match) => ({
        phase: match[1],
        command: [...match[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join(" "),
      }))
    : [];
  const livePhases = livePhaseEntries.map((entry) => entry.phase);
  for (const entry of livePhaseEntries) {
    const frozen = oracle.phaseVector.orderedPhases.find(
      (candidate) => candidate.phase === entry.phase,
    );
    if (frozen && frozen.command !== entry.command) {
      emit(
        "phase_drift",
        `phase ${entry.phase} now runs \`${entry.command}\` but the oracle froze \`${frozen.command}\``,
      );
    }
  }
  const scorecardLiteral =
    /const PR_ATHENA_SCORECARD_PHASE[^=]*=\s*\{\s*phase:\s*"scorecard"/.test(
      deliveryRunSource,
    );
  const oraclePhases = oracle.phaseVector.orderedPhases.map((entry) => entry.phase);
  if (
    !equalStringArrays([...livePhases, ...(scorecardLiteral ? ["scorecard"] : [])], oraclePhases)
  ) {
    emit(
      "phase_drift",
      `the live pr:athena phase order (${livePhases.join(", ")}${scorecardLiteral ? ", scorecard" : ""}) no longer matches the oracle phase vector (${oraclePhases.join(", ")})`,
    );
  }

  // -- Obligation parity against the live gate registry ----------------------
  const gate = HARNESS_GATE_REGISTRY.gates["athena.pr-validation"];
  const documentObligationIds = new Set(
    document.obligations.map((obligation) => obligation.obligationId),
  );
  for (const obligationId of gate.obligationIds) {
    if (!documentObligationIds.has(obligationId)) {
      emit(
        "obligation_drift",
        `live gate obligation ${obligationId} is not activated by the declarative policy document`,
      );
    }
    const oracleObligation = oracle.activationVector.obligations[obligationId];
    const liveObligation = HARNESS_GATE_REGISTRY.obligations[obligationId];
    if (!oracleObligation || !liveObligation) {
      emit(
        "obligation_drift",
        `obligation ${obligationId} is missing from the oracle activation vector or the live registry`,
      );
      continue;
    }
    if (oracleObligation.activation !== liveObligation.activation.kind) {
      emit(
        "obligation_drift",
        `obligation ${obligationId} activation is ${liveObligation.activation.kind} live but ${oracleObligation.activation} in the oracle`,
      );
    }
    if (liveObligation.activation.kind === "review_projection") {
      if (
        oracleObligation.minimumRelevantChangedLines !==
          liveObligation.activation.minimumRelevantChangedLines ||
        oracleObligation.sensitiveScenarioCount !==
          liveObligation.activation.sensitiveScenarioIds.length ||
        oracleObligation.relevantBinaryChangeActivates !==
          liveObligation.activation.relevantBinaryChangeActivates
      ) {
        emit(
          "obligation_drift",
          `obligation ${obligationId} review-projection activation parameters drifted from the oracle`,
        );
      }
    }
    if (
      !equalStringArrays(
        [...oracleObligation.providers].sort(),
        [...liveObligation.providerIds].sort(),
      )
    ) {
      emit(
        "obligation_drift",
        `obligation ${obligationId} providers drifted from the oracle`,
      );
    }
    if (
      oracleObligation.freshness !== liveObligation.freshness.kind ||
      oracleObligation.providerPolicy !== liveObligation.providerPolicy ||
      !equalStringArrays(
        [...oracleObligation.ciDelegation].sort(),
        [...liveObligation.ciDelegationPolicyIds].sort(),
      )
    ) {
      emit(
        "obligation_drift",
        `obligation ${obligationId} freshness, provider policy, or CI delegation drifted from the oracle`,
      );
    }
  }
  const telemetryOracle = oracle.activationVector.obligations["telemetry.recorded"];
  if (
    telemetryOracle?.blockingThresholdSourceLines !==
    DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD
  ) {
    emit(
      "obligation_drift",
      `the oracle telemetry blocking threshold (${telemetryOracle?.blockingThresholdSourceLines}) no longer matches the live threshold (${DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD})`,
    );
  }

  // -- Authority: merge-ready default, merge/deploy ungranted ----------------
  if (
    !equalStringArrays(document.grantedFinishLines, ["merge-ready"]) ||
    !equalStringArrays(document.grantedAuthority, ["pr-creation"]) ||
    !equalStringArrays([...document.forbiddenAuthority].sort(), ["deploy", "merge"])
  ) {
    emit(
      "authority_drift",
      "the declarative document must grant exactly the merge-ready finish line and pr-creation authority, with merge and deploy forbidden",
    );
  }
  if (
    !equalStringArrays(snapshot.compiled.snapshot.grantedFinishLines, ["merge-ready"]) ||
    !equalStringArrays(snapshot.compiled.snapshot.grantedAuthority, ["pr-creation"])
  ) {
    emit(
      "authority_drift",
      "the recorded compiled snapshot grants a finish line or authority the projection must not grant",
    );
  }
  if (
    !equalStringArrays(
      snapshot.compiled.snapshot.obligations.map((entry) => entry.obligationId),
      document.obligations.map((entry) => entry.obligationId),
    )
  ) {
    emit(
      "authority_drift",
      "the recorded compiled snapshot obligations do not match the declarative document obligations",
    );
  }

  // -- Each lens names the reviewer charter it hands its reviewer ------------
  // Enumerated off the document's own lens list, and off the snapshot's own
  // lens list, position by position. A claim phrased over "every lens" is
  // satisfied for free by a document that declares none and by a snapshot the
  // document never reaches, so the count is pinned first and each member is
  // then named individually.
  const documentLenses = document.reviewLenses;
  const snapshotLenses = snapshot.compiled.snapshot.reviewLenses;
  if (!Array.isArray(documentLenses) || documentLenses.length === 0) {
    emit(
      "lens_persona_defect",
      "the declarative document activates no review lens; the review floor is not lowered by omission and a per-lens charter claim over an empty list proves nothing",
    );
  } else if (!Array.isArray(snapshotLenses) || snapshotLenses.length !== documentLenses.length) {
    emit(
      "lens_persona_defect",
      `the document declares ${documentLenses.length} review lens(es) and the recorded compiled snapshot carries ${
        Array.isArray(snapshotLenses) ? snapshotLenses.length : 0
      }; the snapshot is not a compile of this document`,
    );
  } else {
    documentLenses.forEach((lens, index) => {
      const compiled = snapshotLenses[index];
      if (typeof lens.personaId !== "string" || !/^persona\.[a-z0-9-]+$/.test(lens.personaId)) {
        emit(
          "lens_persona_defect",
          `document lens ${lens.lensId ?? `#${index}`} names no reviewer charter; personaId is a required member of a lens declaration and the policy does not compile without it`,
        );
      }
      // Athena references shipped charters by identity alone. Pinning charter
      // bytes here would claim repository-owned charters this repository does
      // not carry, and would put advancing the shipped set behind an edit to
      // this document.
      if (lens.personaDigest !== undefined) {
        emit(
          "lens_persona_defect",
          `document lens ${lens.lensId ?? `#${index}`} pins charter bytes; Athena supplies no repository-owned charter, so its lenses reference shipped charters by identity and the digest is bound at compilation instead`,
        );
      }
      if (
        compiled.lensId !== lens.lensId ||
        compiled.category !== lens.category ||
        compiled.personaId !== lens.personaId
      ) {
        emit(
          "lens_persona_defect",
          `document lens ${lens.lensId ?? `#${index}`} (${lens.category}, ${lens.personaId}) does not match the recorded compiled lens ${compiled.lensId} (${compiled.category}, ${compiled.personaId})`,
        );
      }
      if (typeof compiled.personaDigest !== "string" || !/^[0-9a-f]{64}$/.test(compiled.personaDigest)) {
        emit(
          "lens_persona_defect",
          `compiled lens ${compiled.lensId ?? `#${index}`} carries no resolved charter digest; identity alone is what the document declares, and compilation is where those bytes get bound`,
        );
      }
    });
  }

  // -- Leaf mapping: each proposed leaf maps exactly once --------------------
  const mappedCapabilityIds = oracle.leafMappings.map((mapping) => mapping.capabilityId);
  const adapterById = new Map(adapters.map((adapter) => [adapter.capabilityId, adapter]));
  if (new Set(mappedCapabilityIds).size !== mappedCapabilityIds.length) {
    emit("leaf_mapping_defect", "a capability is mapped by more than one oracle leaf");
  }
  const leafNames = oracle.leafMappings.map((mapping) => mapping.leaf);
  if (new Set(leafNames).size !== leafNames.length) {
    emit("leaf_mapping_defect", "a proposed leaf appears more than once in the oracle mapping");
  }
  for (const mapping of oracle.leafMappings) {
    const adapter = adapterById.get(mapping.capabilityId);
    if (!adapter) {
      emit(
        "leaf_mapping_defect",
        `oracle leaf ${mapping.leaf} maps to ${mapping.capabilityId}, which no adapter declares`,
      );
    } else if (adapter.kind !== mapping.kind) {
      emit(
        "leaf_mapping_defect",
        `oracle leaf ${mapping.leaf} expects kind ${mapping.kind} but the adapter binds ${adapter.kind}`,
      );
    }
  }
  for (const adapter of adapters) {
    if (!mappedCapabilityIds.includes(adapter.capabilityId)) {
      emit(
        "leaf_mapping_defect",
        `adapter ${adapter.capabilityId} is declared but mapped by no oracle leaf`,
      );
    }
  }
  for (const required of document.requiredCapabilities) {
    const adapter = adapterById.get(required.capabilityId);
    if (!adapter || adapter.kind !== required.kind || adapter.version !== required.version) {
      emit(
        "leaf_mapping_defect",
        `required capability ${required.capabilityId} has no matching adapter declaration`,
      );
    }
    if (required.kind === "merge" || required.kind === "deploy") {
      emit(
        "leaf_mapping_defect",
        `required capability ${required.capabilityId} would make an ungranted ${required.kind} action a delivery requirement`,
      );
    }
  }
  const aggregateExcluded = oracle.aggregateExclusions.some(
    (exclusion) => exclusion.entrypoint === "pr:athena",
  );
  if (!aggregateExcluded) {
    emit(
      "aggregate_registered_as_leaf",
      "the oracle no longer records the pr:athena aggregate exclusion",
    );
  }
  for (const value of [...mappedCapabilityIds, ...adapters.map((a) => a.capabilityId)]) {
    if (value.includes("pr-athena") || value.includes("pr:athena")) {
      emit(
        "aggregate_registered_as_leaf",
        `${value} registers the aggregate entrypoint as a leaf; the aggregate re-enters review, evidence, admission, and validation and is the comparison authority, never a leaf`,
      );
    }
  }

  // -- Activation scenarios against the live mechanical selection ------------
  const probes = oracle.activationVector.mechanicalSelectionProbes;
  for (const [scenario, frozenSelection] of Object.entries(
    oracle.activationVector.mechanicalSelection,
  )) {
    const probe = probes[scenario];
    if (!probe) {
      emit(
        "mechanical_activation_drift",
        `oracle scenario ${scenario} has no probe changed-file set`,
      );
      continue;
    }
    const liveSelection = formatMechanicalSelection(selectMechanicalCommands(probe));
    if (!equalStringArrays(liveSelection, frozenSelection)) {
      emit(
        "mechanical_activation_drift",
        `scenario ${scenario} now selects [${liveSelection.join(", ")}] but the oracle froze [${frozenSelection.join(", ")}]`,
      );
    }
  }

  // -- Generated artifacts remain generator-owned ----------------------------
  const ownership = oracle.generatedArtifactOwnership;
  if (ownership.repairStage !== "stage.generated-artifact-repair") {
    emit(
      "generated_ownership_drift",
      "the oracle no longer assigns generated artifacts to the generated-artifact repair stage",
    );
  }
  const oracleGroupPaths = new Map(
    ownership.groups.map((group) => [group.id, group.paths]),
  );
  if (
    !equalStringArrays(
      oracleGroupPaths.get("graphify") ?? [],
      TRACKED_GRAPHIFY_ARTIFACTS as readonly string[] as string[],
    )
  ) {
    emit(
      "generated_ownership_drift",
      "the oracle graphify artifact list drifted from the tracked graphify artifacts",
    );
  }
  if (
    !equalStringArrays(
      oracleGroupPaths.get("agent-sdk") ?? [],
      AGENT_SDK_GENERATED_ARTIFACTS as readonly string[] as string[],
    )
  ) {
    emit(
      "generated_ownership_drift",
      "the oracle agent-sdk artifact list drifted from the generated agent-sdk artifacts",
    );
  }
  const preCommitSource = await readFile(
    path.join(rootDir, "scripts", "pre-commit-generated-artifacts.ts"),
    "utf8",
  );
  for (const convexPath of oracleGroupPaths.get("convex-generated-api") ?? []) {
    const fileName = convexPath.split("/").at(-1)!;
    if (!preCommitSource.includes(`"${fileName}"`)) {
      emit(
        "generated_ownership_drift",
        `oracle convex generated artifact ${convexPath} is not named by the generated-artifact repair stage`,
      );
    }
  }
  for (const group of ownership.groups) {
    for (const artifactPath of group.paths ?? []) {
      if (group.id !== "harness-docs" && !coveredByProtectedTree(artifactPath)) {
        emit(
          "generated_ownership_drift",
          `generated artifact ${artifactPath} is not covered by a protected generated tree`,
        );
      }
    }
  }
  for (const override of document.checkpoints ?? []) {
    for (const tree of PROTECTED_GENERATED_TREES) {
      if (!override.additionalProtectedPaths.includes(tree)) {
        emit(
          "generated_ownership_drift",
          `checkpoint ${override.stageId} does not protect the generated tree ${tree}`,
        );
      }
    }
  }
  for (const grant of snapshot.compiled.checkpointGrants) {
    for (const tree of PROTECTED_GENERATED_TREES) {
      if (!grant.grant.protectedPaths.includes(tree)) {
        emit(
          "generated_ownership_drift",
          `compiled grant for ${grant.stageId} does not protect the generated tree ${tree}`,
        );
      }
    }
  }

  // -- Every observed-only mismatch carries a disposition --------------------
  if (!Array.isArray(report.adjudications) || report.adjudications.length === 0) {
    emit(
      "adjudication_incomplete",
      "the comparison report records no adjudications; the observed-only mismatch record cannot be emptied without a deliberate recharacterization",
    );
  }
  const adjudicationIds = new Set<string>();
  for (const adjudication of report.adjudications ?? []) {
    if (
      !adjudication.id ||
      adjudicationIds.has(adjudication.id) ||
      !ADJUDICATION_DISPOSITIONS.has(adjudication.disposition ?? "") ||
      adjudication.blocking !== false
    ) {
      emit(
        "adjudication_incomplete",
        `comparison-report adjudication ${adjudication.id ?? "<unnamed>"} must carry a unique id, a recorded disposition, and an explicit non-blocking marker`,
      );
    }
    if (adjudication.id) adjudicationIds.add(adjudication.id);
  }

  } catch (error) {
    emit(
      "artifact_unreadable",
      `a policy artifact does not have the expected shape: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return { status: findings.length === 0 ? "pass" : "fail", findings };
}

if (import.meta.main) {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const result = await runPolicyProjectionCheck(rootDir);
  if (result.status === "pass") {
    console.log(
      "[policy-projection] Read-only comparison passed: the layered policy projection matches the legacy pr:athena authority and the frozen pre-cutover oracle.",
    );
  } else {
    console.log(
      `[policy-projection] Found ${result.findings.length} comparison finding(s):`,
    );
    for (const finding of result.findings) {
      console.log(`  - [${finding.code}] ${finding.message}`);
    }
  }
  process.exitCode = result.status === "pass" ? 0 : 1;
}

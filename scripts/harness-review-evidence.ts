import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  HarnessBlockedError,
  createHarnessBlocker,
  HarnessUsageError,
  runHarnessCliBoundary,
} from "./harness-blockers";
import { captureStableHarnessCandidate } from "./harness-candidate";
import {
  HARNESS_GATE_REGISTRY,
  type HistoricalReviewProviderId,
  type HarnessProviderId,
} from "./harness-gate-registry";
import {
  isValidReviewCost,
  isValidReviewLoopTelemetry,
  publishHarnessObligationRecord,
  resolveHarnessObligationStorageContext,
  type HarnessObligationCandidateBinding,
  type HarnessReviewLoopTelemetry,
} from "./harness-obligation-records";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";
import {
  evaluatePrAthenaPreparationReceipt,
  type PrAthenaPreparationEvaluation,
} from "./pr-athena-prepare";

export const HARNESS_REVIEW_MANIFEST_SCHEMA_VERSION = 1;
export const HARNESS_REVIEWER_ARTIFACT_SCHEMA_VERSION = 1;
type ApprovedReviewProviderId = HistoricalReviewProviderId;

type FinalReviewFinding = {
  id: string;
  actionable: boolean;
  blocking: boolean;
  severity: "P0" | "P1" | "P2" | "P3";
  scope: "in_contract" | "adjacent" | "expansion";
  disposition:
    | "resolved"
    | "advisory"
    | "pre_existing"
    | "deferred"
    | "unresolved"
    | "ignored";
  deferredIssueId?: string;
};

const FINDING_SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
const FINDING_SCOPES = ["in_contract", "adjacent", "expansion"] as const;
/**
 * A tracker id, not merely a non-empty string: "TODO" or "x" must not read as
 * filed work once it is copied into the obligation record and the run summary.
 * Existence is still unverifiable from here — the shape check is the floor.
 */
const DEFERRED_ISSUE_ID = /^[A-Z][A-Z0-9]*-\d+$/;

export type HarnessFinalReviewManifest = {
  schemaVersion: typeof HARNESS_REVIEW_MANIFEST_SCHEMA_VERSION;
  providerId: ApprovedReviewProviderId;
  runId: string;
  providerRunRoot: string;
  finalPassId: string;
  worktreeId: string;
  candidate: HarnessObligationCandidateBinding;
  selectedReviewers: string[];
  completedReviewers: string[];
  failedReviewers: string[];
  timedOutReviewers: string[];
  reviewerArtifacts: string[];
  findings: FinalReviewFinding[];
  mutationSequence: Array<{
    preparedTreeSha: string;
    reviewedInPassId: string;
  }>;
  verdict: "green";
  unresolvedActionableCount: 0;
  blockingCount: 0;
  editedAfterFinalPass: false;
  finalized: true;
  reviewLoopTelemetry: HarnessReviewLoopTelemetry;
};

type HarnessReviewerArtifact = {
  schemaVersion: typeof HARNESS_REVIEWER_ARTIFACT_SCHEMA_VERSION;
  providerId: ApprovedReviewProviderId;
  runId: string;
  finalPassId: string;
  worktreeId: string;
  candidate: HarnessObligationCandidateBinding;
  reviewerId: string;
  result: "approved";
};

type CandidateCaptureResult =
  | { ok: true; candidate: HarnessObligationCandidateBinding }
  | { ok: false; status: string; reason: string };

type RecorderOptions = {
  storageDir?: string;
  providerRunRoots?: Partial<Record<ApprovedReviewProviderId, string>>;
  captureCandidate?: (rootDir: string) => Promise<CandidateCaptureResult>;
  resolveWorktreeId?: (rootDir: string) => Promise<string>;
  now?: () => string;
};

const REVIEW_OBLIGATION = HARNESS_GATE_REGISTRY.obligations["review.green"];

function isApprovedReviewProviderId(
  value: unknown,
): value is ApprovedReviewProviderId {
  if (typeof value !== "string") return false;
  const provider = HARNESS_GATE_REGISTRY.providers[value];
  return (
    REVIEW_OBLIGATION.providerIds.includes(value as HarnessProviderId) &&
    provider?.kind === "historical_evidence"
  );
}

function defaultProviderRoot(providerId: ApprovedReviewProviderId) {
  return path.join(tmpdir(), "compound-engineering", providerId);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new Error(`review manifest ${field} must be a string array`);
  }
  return value;
}

function hasDuplicates(values: string[]) {
  return new Set(values).size !== values.length;
}

function isSinglePathComponent(value: string) {
  return (
    value !== "." &&
    value !== ".." &&
    !value.includes("\0") &&
    path.posix.basename(value) === value &&
    path.win32.basename(value) === value
  );
}

function candidateBinding(value: unknown): HarnessObligationCandidateBinding {
  if (!value || typeof value !== "object") {
    throw new Error("review manifest candidate is missing");
  }
  const candidate = value as Partial<HarnessObligationCandidateBinding>;
  if (
    !isNonEmptyString(candidate.treeSha) ||
    !isNonEmptyString(candidate.baseRef) ||
    !isNonEmptyString(candidate.baseTipSha) ||
    !isNonEmptyString(candidate.diffBaseSha)
  ) {
    throw new Error("review manifest candidate is incomplete");
  }
  if (
    !isNonEmptyString(candidate.deliverableTreeSha) ||
    candidate.identityVersion !== HARNESS_REVIEW_IDENTITY_VERSION
  ) {
    throw new Error(
      `review manifest candidate must name a ${HARNESS_REVIEW_IDENTITY_VERSION} deliverable identity; take it from \`bun run harness:review-context\``,
    );
  }
  return candidate as HarnessObligationCandidateBinding;
}

function parseManifest(value: unknown): HarnessFinalReviewManifest {
  if (!value || typeof value !== "object")
    throw new Error("review manifest must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== HARNESS_REVIEW_MANIFEST_SCHEMA_VERSION) {
    throw new Error("unsupported review manifest schema");
  }
  if (!isApprovedReviewProviderId(raw.providerId)) {
    throw new Error("review manifest provider is not approved");
  }
  for (const field of ["runId", "finalPassId", "worktreeId"] as const) {
    if (!isNonEmptyString(raw[field]))
      throw new Error(`review manifest ${field} is missing`);
  }
  if (!isSinglePathComponent(raw.runId as string)) {
    throw new Error("review manifest runId must be a single path component");
  }
  if (!isNonEmptyString(raw.providerRunRoot)) {
    throw new Error("review manifest provider run root is missing");
  }
  const selectedReviewers = stringArray(
    raw.selectedReviewers,
    "selectedReviewers",
  );
  const completedReviewers = stringArray(
    raw.completedReviewers,
    "completedReviewers",
  );
  const failedReviewers = stringArray(raw.failedReviewers, "failedReviewers");
  const timedOutReviewers = stringArray(
    raw.timedOutReviewers,
    "timedOutReviewers",
  );
  const reviewerArtifacts = stringArray(
    raw.reviewerArtifacts,
    "reviewerArtifacts",
  );
  if (selectedReviewers.length === 0)
    throw new Error("review manifest selected no reviewers");
  if (
    hasDuplicates(selectedReviewers) ||
    hasDuplicates(completedReviewers)
  ) {
    throw new Error("review manifest reviewers must be unique");
  }
  const selected = new Set(selectedReviewers);
  if (
    completedReviewers.length !== selectedReviewers.length ||
    completedReviewers.some((reviewer) => !selected.has(reviewer))
  ) {
    throw new Error("review manifest has incomplete required reviewers");
  }
  if (failedReviewers.length > 0 || timedOutReviewers.length > 0) {
    throw new Error("review manifest has failed or timed out reviewers");
  }
  if (
    hasDuplicates(reviewerArtifacts) ||
    reviewerArtifacts.length !== selectedReviewers.length
  ) {
    throw new Error(
      "review manifest must name exactly one reviewer artifact per selected reviewer",
    );
  }
  if (raw.verdict !== "green" || raw.finalized !== true) {
    throw new Error("review manifest is not finalized green");
  }
  if (raw.unresolvedActionableCount !== 0 || raw.blockingCount !== 0) {
    throw new Error(
      "review manifest has unresolved actionable or blocking findings",
    );
  }
  if (raw.editedAfterFinalPass !== false) {
    throw new Error("review manifest reports an edit after its final pass");
  }
  if (!Array.isArray(raw.findings))
    throw new Error("review manifest findings are missing");
  const findings = raw.findings as FinalReviewFinding[];
  if (
    findings.some(
      (finding) =>
        !isNonEmptyString(finding?.id) ||
        typeof finding.actionable !== "boolean" ||
        typeof finding.blocking !== "boolean" ||
        !FINDING_SEVERITIES.includes(finding.severity) ||
        !FINDING_SCOPES.includes(finding.scope) ||
        ![
          "resolved",
          "advisory",
          "pre_existing",
          "deferred",
          "unresolved",
          "ignored",
        ].includes(finding.disposition),
    )
  ) {
    throw new Error("review manifest contains an invalid finding");
  }
  const deferredFindings = findings.filter(
    (finding) => finding.disposition === "deferred",
  );
  if (
    deferredFindings.some(
      (finding) =>
        !finding.actionable ||
        finding.blocking ||
        !isNonEmptyString(finding.deferredIssueId),
    )
  ) {
    throw new Error(
      "review manifest deferred findings must be actionable, non-blocking, and name their filed follow-up issue id",
    );
  }
  // The eligibility rule is enforced here rather than trusted to the reviewing
  // agent: the same orchestrator authors the manifest, so "P0/P1 never defer"
  // and "only expansion defers" must be machine-checked to mean anything.
  if (
    deferredFindings.some((finding) => ["P0", "P1"].includes(finding.severity))
  ) {
    throw new Error(
      "review manifest defers a P0/P1 finding; critical and high-severity findings block regardless of scope",
    );
  }
  if (deferredFindings.some((finding) => finding.scope !== "expansion")) {
    throw new Error(
      "review manifest defers a finding whose scope is not expansion; only work beyond the delivery contract may be deferred",
    );
  }
  if (
    deferredFindings.some(
      (finding) => !DEFERRED_ISSUE_ID.test(finding.deferredIssueId as string),
    )
  ) {
    throw new Error(
      "review manifest deferred findings must name a tracker-shaped follow-up issue id (e.g. V26-1234)",
    );
  }
  if (
    findings.some(
      (finding) =>
        finding.blocking ||
        (finding.actionable &&
          !["resolved", "pre_existing", "deferred"].includes(
            finding.disposition,
          )),
    )
  ) {
    throw new Error(
      "review manifest contains unresolved or ignored actionable findings",
    );
  }
  if (!Array.isArray(raw.mutationSequence)) {
    throw new Error("review manifest mutation sequence is missing");
  }
  const mutationSequence =
    raw.mutationSequence as HarnessFinalReviewManifest["mutationSequence"];
  if (
    mutationSequence.some(
      (mutation) =>
        !isNonEmptyString(mutation?.preparedTreeSha) ||
        !isNonEmptyString(mutation?.reviewedInPassId),
    )
  ) {
    throw new Error("review manifest mutation sequence is invalid");
  }
  const candidate = candidateBinding(raw.candidate);
  const finalMutation = mutationSequence.at(-1);
  if (
    finalMutation &&
    (finalMutation.preparedTreeSha !== candidate.treeSha ||
      finalMutation.reviewedInPassId !== raw.finalPassId)
  ) {
    throw new Error(
      "review manifest final mutation was not prepared and re-reviewed in the final pass",
    );
  }
  const deferredIssueIds = deferredFindings
    .map((finding) => finding.deferredIssueId as string)
    .sort((left, right) => left.localeCompare(right));
  let reviewLoopTelemetry: HarnessReviewLoopTelemetry;
  if (raw.reviewLoopTelemetry === undefined) {
    // Older manifests carry no telemetry block; derive the loop facts that are
    // provable from the manifest itself so every new record is trend-readable.
    reviewLoopTelemetry = {
      iterationCount: Math.max(1, mutationSequence.length),
      findingCounts: findings.reduce(
        (counts, finding) => ({ ...counts, [finding.severity]: counts[finding.severity] + 1 }),
        { P0: 0, P1: 0, P2: 0, P3: 0 } as Record<"P0" | "P1" | "P2" | "P3", number>,
      ),
      deferredExpansionCount: deferredFindings.length,
      deferredIssueIds,
    };
  } else {
    const telemetry = raw.reviewLoopTelemetry as
      Partial<HarnessReviewLoopTelemetry>;
    if (
      telemetry.reviewCost !== undefined &&
      !isValidReviewCost(telemetry.reviewCost)
    ) {
      throw new Error(
        "review manifest telemetry reviewCost must name a unit and a non-negative total, with per-reviewer amounts summing no higher than the run total",
      );
    }
    // Shape is validated by the one shared predicate; only the cross-check
    // against this manifest's own findings is local to here.
    if (!isValidReviewLoopTelemetry(telemetry)) {
      throw new Error(
        "review manifest telemetry is invalid: iterationCount must be a positive integer, " +
          "findingCounts non-negative integers for P0-P3, and deferredIssueIds a string list " +
          "matching deferredExpansionCount",
      );
    }
    const claimedIds = [...telemetry.deferredIssueIds].sort((left, right) =>
      left.localeCompare(right),
    );
    if (
      telemetry.deferredExpansionCount !== deferredFindings.length ||
      claimedIds.length !== deferredIssueIds.length ||
      claimedIds.some((id, index) => id !== deferredIssueIds[index])
    ) {
      throw new Error(
        "review manifest telemetry deferral facts must match the deferred findings",
      );
    }
    // Derived from the findings, never taken on trust: every finding now
    // carries a validated severity, so a claimed all-zero count over a findings
    // array containing P0/P1 would let a record misdescribe its own run with no
    // trace. The deferral facts are cross-checked the same way.
    const derivedCounts = findings.reduce(
      (counts, finding) => ({ ...counts, [finding.severity]: counts[finding.severity] + 1 }),
      { P0: 0, P1: 0, P2: 0, P3: 0 } as Record<"P0" | "P1" | "P2" | "P3", number>,
    );
    if (
      telemetry.findingCounts !== undefined &&
      (["P0", "P1", "P2", "P3"] as const).some(
        (severity) => telemetry.findingCounts?.[severity] !== derivedCounts[severity],
      )
    ) {
      throw new Error(
        "review manifest telemetry findingCounts must match the severities of the manifest's own findings",
      );
    }
    reviewLoopTelemetry = {
      iterationCount: telemetry.iterationCount as number,
      findingCounts: derivedCounts,
      deferredExpansionCount: deferredFindings.length,
      deferredIssueIds,
      ...(telemetry.reviewCost ? { reviewCost: telemetry.reviewCost } : {}),
    };
  }

  return {
    schemaVersion: HARNESS_REVIEW_MANIFEST_SCHEMA_VERSION,
    providerId: raw.providerId as ApprovedReviewProviderId,
    runId: raw.runId as string,
    providerRunRoot: raw.providerRunRoot as string,
    finalPassId: raw.finalPassId as string,
    worktreeId: raw.worktreeId as string,
    candidate,
    selectedReviewers,
    completedReviewers,
    failedReviewers,
    timedOutReviewers,
    reviewerArtifacts,
    findings,
    mutationSequence,
    verdict: "green",
    unresolvedActionableCount: 0,
    blockingCount: 0,
    editedAfterFinalPass: false,
    finalized: true,
    reviewLoopTelemetry,
  };
}

function parseReviewerArtifact(
  value: unknown,
  manifest: HarnessFinalReviewManifest,
): HarnessReviewerArtifact {
  if (!value || typeof value !== "object") {
    throw new Error("reviewer artifact must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== HARNESS_REVIEWER_ARTIFACT_SCHEMA_VERSION) {
    throw new Error("reviewer artifact has an unsupported schema");
  }
  if (
    raw.providerId !== manifest.providerId ||
    raw.runId !== manifest.runId ||
    raw.finalPassId !== manifest.finalPassId ||
    raw.worktreeId !== manifest.worktreeId
  ) {
    throw new Error("reviewer artifact does not match the finalized review");
  }
  if (!isNonEmptyString(raw.reviewerId)) {
    throw new Error("reviewer artifact reviewerId is missing");
  }
  if (raw.result !== "approved") {
    throw new Error("reviewer artifact final result is not approved");
  }
  const candidate = candidateBinding(raw.candidate);
  if (!sameCandidate(candidate, manifest.candidate)) {
    throw new Error("reviewer artifact candidate does not match the manifest");
  }
  return {
    schemaVersion: HARNESS_REVIEWER_ARTIFACT_SCHEMA_VERSION,
    providerId: manifest.providerId,
    runId: manifest.runId,
    finalPassId: manifest.finalPassId,
    worktreeId: manifest.worktreeId,
    candidate,
    reviewerId: raw.reviewerId,
    result: "approved",
  };
}

function isWithin(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/**
 * Recording stays strict on the raw tree, deliberately.
 *
 * The deliverable identity exists so an approval survives a report or solution
 * note committed *after* the final pass — that is a gate-time concern. At
 * recording time the manifest is being written against the tree that was just
 * prepared and reviewed, so requiring an exact `treeSha` match costs nothing and
 * buys something the gate cannot: it proves the raw tree the record names is the
 * tree that actually existed. That value is persisted into the obligation record
 * and the gate decision event as the audit anchor, so it must be verified rather
 * than taken from the provider's word.
 */
function sameCandidate(
  left: HarnessObligationCandidateBinding,
  right: HarnessObligationCandidateBinding,
) {
  return (
    left.identityVersion === HARNESS_REVIEW_IDENTITY_VERSION &&
    right.identityVersion === HARNESS_REVIEW_IDENTITY_VERSION &&
    Boolean(left.deliverableTreeSha) &&
    left.deliverableTreeSha === right.deliverableTreeSha &&
    left.treeSha === right.treeSha &&
    left.baseRef === right.baseRef &&
    left.baseTipSha === right.baseTipSha &&
    left.diffBaseSha === right.diffBaseSha
  );
}

async function defaultCaptureCandidate(
  rootDir: string,
): Promise<CandidateCaptureResult> {
  const captured = await captureStableHarnessCandidate(rootDir);
  if (!captured.ok) return captured;
  const {
    treeSha,
    deliverableTreeSha,
    identityVersion,
    baseRef,
    baseTipSha,
    diffBaseSha,
  } = captured.candidate;
  return {
    ok: true,
    candidate: {
      treeSha,
      deliverableTreeSha,
      identityVersion,
      baseRef,
      baseTipSha,
      diffBaseSha,
    },
  };
}

export async function recordHarnessReviewEvidence(
  rootDir: string,
  manifestPath: string,
  options: RecorderOptions = {},
) {
  const rawManifest = await readFile(manifestPath, "utf8");
  let manifest: HarnessFinalReviewManifest;
  try {
    manifest = parseManifest(JSON.parse(rawManifest));
  } catch (error) {
    throw new Error(
      `Invalid finalized review manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const providerRoot = path.resolve(
    options.providerRunRoots?.[manifest.providerId] ??
      defaultProviderRoot(manifest.providerId),
  );
  const [realManifestPath, realProviderRoot] = await Promise.all([
    realpath(manifestPath),
    realpath(providerRoot),
  ]);
  const expectedRunDir = await realpath(
    path.join(realProviderRoot, manifest.runId),
  ).catch(() => null);
  if (!expectedRunDir || manifest.providerRunRoot !== expectedRunDir) {
    throw new Error(
      "Finalized review manifest does not name its exact resolved provider run root",
    );
  }
  if (realManifestPath !== path.join(expectedRunDir, "final-manifest.json")) {
    throw new Error(
      "Finalized review manifest is not at the exact final-manifest location",
    );
  }
  const reviewerIds = new Set<string>();
  for (const artifact of manifest.reviewerArtifacts) {
    if (path.isAbsolute(artifact))
      throw new Error("Reviewer artifact path must be relative");
    const artifactPath = await realpath(
      path.join(expectedRunDir, artifact),
    ).catch(() => null);
    if (!artifactPath || !isWithin(expectedRunDir, artifactPath)) {
      throw new Error(
        `Required reviewer artifact is missing or outside the run: ${artifact}`,
      );
    }
    let reviewerArtifact: HarnessReviewerArtifact;
    try {
      reviewerArtifact = parseReviewerArtifact(
        JSON.parse(await readFile(artifactPath, "utf8")),
        manifest,
      );
    } catch (error) {
      throw new Error(
        `Invalid reviewer artifact ${artifact}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (reviewerIds.has(reviewerArtifact.reviewerId)) {
      throw new Error(
        `Review manifest has more than one artifact for reviewer ${reviewerArtifact.reviewerId}`,
      );
    }
    reviewerIds.add(reviewerArtifact.reviewerId);
  }
  if (
    reviewerIds.size !== manifest.selectedReviewers.length ||
    manifest.selectedReviewers.some((reviewer) => !reviewerIds.has(reviewer))
  ) {
    throw new Error(
      "Review manifest must have exactly one artifact for every selected and completed reviewer",
    );
  }
  const [captured, worktreeId] = await Promise.all([
    (options.captureCandidate ?? defaultCaptureCandidate)(rootDir),
    options.resolveWorktreeId
      ? options.resolveWorktreeId(rootDir)
      : resolveHarnessObligationStorageContext(rootDir, {
          storageDir: options.storageDir,
        }).then((context) => context.worktreeId),
  ]);
  if (!captured.ok) {
    throw new Error(`Current candidate cannot be verified: ${captured.reason}`);
  }
  if (manifest.worktreeId !== worktreeId) {
    throw new Error("Review manifest belongs to another worktree");
  }
  if (!sameCandidate(manifest.candidate, captured.candidate)) {
    throw new Error(
      "Review manifest candidate does not match the current prepared candidate",
    );
  }
  const manifestDigest = createHash("sha256").update(rawManifest).digest("hex");
  return publishHarnessObligationRecord(
    rootDir,
    {
      gateId: "athena.pr-validation",
      obligationId: "review.green",
      candidate: manifest.candidate,
      resolution: {
        kind: "evidence",
        providerId: manifest.providerId,
        runId: manifest.runId,
        finalPassId: manifest.finalPassId,
        manifestDigest,
        outcome: "green",
        blockingCount: 0,
        unresolvedActionableCount: 0,
        degradedReviewerCount: 0,
        reviewLoopTelemetry: manifest.reviewLoopTelemetry,
      },
    },
    { storageDir: options.storageDir, now: options.now },
  );
}

/**
 * Requiring the preparation receipt here is what makes the mechanical stage an
 * ordering *mechanism* rather than a convention: preparation publishes no
 * receipt for a tree that fails a deterministic rule, so a reviewer cannot even
 * be given a candidate to review until that tree passes.
 */
export async function collectHarnessReviewContext(
  rootDir: string,
  options: {
    evaluatePreparation?: (
      rootDir: string,
    ) => Promise<PrAthenaPreparationEvaluation>;
  } = {},
) {
  const preparation = await (
    options.evaluatePreparation ?? evaluatePrAthenaPreparationReceipt
  )(rootDir);
  if (!preparation.prepared) {
    throw new Error(
      `Review context is unavailable: ${preparation.reason}. Remediation: ${preparation.remediation}`,
    );
  }
  const [captured, storage] = await Promise.all([
    defaultCaptureCandidate(rootDir),
    resolveHarnessObligationStorageContext(rootDir, {}),
  ]);
  if (!captured.ok) {
    throw new Error(`Current candidate cannot be verified: ${captured.reason}`);
  }
  return { worktreeId: storage.worktreeId, candidate: captured.candidate };
}

export type ReviewEvidenceInvocation =
  | { command: "context"; manifestPath?: undefined }
  | { command: "record"; manifestPath: string };

/**
 * Exported for its sibling test: a malformed invocation is a usage error, not
 * a crash, so the rejection shape is part of this CLI's operator contract.
 */
export function parseReviewEvidenceInvocation(
  argv: string[],
): ReviewEvidenceInvocation {
  const [command, manifestPath] = argv;
  if (command === "context" && !manifestPath) {
    return { command: "context" };
  }
  if (command !== "record" || !manifestPath || argv.length !== 2) {
    throw new HarnessUsageError({
      // Same derivation the boundary uses for its source, so the usage blocker
      // names whichever command the operator actually invoked.
      source: {
        kind: "command",
        id:
          command === "context"
            ? "harness:review-context"
            : "harness:review-evidence",
      },
      message:
        "Usage: bun scripts/harness-review-evidence.ts <context|record finalized-manifest-path>",
      validFlags: ["context", "record <finalized-manifest-path>"],
    });
  }
  return { command: "record", manifestPath };
}

async function main() {
  const invocation = parseReviewEvidenceInvocation(process.argv.slice(2));
  if (invocation.command === "context") {
    console.log(
      JSON.stringify(await collectHarnessReviewContext(process.cwd())),
    );
    return;
  }
  const result = await recordHarnessReviewEvidence(
    process.cwd(),
    invocation.manifestPath,
  );
  console.log(
    JSON.stringify({
      kind: "review_evidence_recorded",
      recordId: result.recordId,
      path: result.path,
    }),
  );
}

export function harnessReviewEvidenceRejectedBlocker(
  reviewCommand: "harness:review-context" | "harness:review-evidence",
  detail: string,
) {
  return createHarnessBlocker({
    code: "harness_review_evidence_rejected",
    source: { kind: "command", id: reviewCommand },
    summary: "The review evidence recorder rejected this manifest.",
    details: detail,
    remediations: [
      {
        id: "repair-review-manifest",
        kind: "code_change",
        summary:
          "Correct the finalized review manifest to satisfy the reported requirement, then record it again.",
      },
      {
        id: "recapture-review-context",
        kind: "command",
        command: ["bun", "run", "harness:review-context"],
        summary:
          "Recapture the candidate context if the manifest no longer names the prepared candidate.",
      },
    ],
  });
}

/**
 * A rejected manifest is the recorder refusing evidence on purpose, so it
 * carries a stable code and a repair rather than an internal-error stack.
 */
async function runHarnessReviewEvidenceCli(
  reviewCommand: "harness:review-context" | "harness:review-evidence",
) {
  try {
    return await main();
  } catch (error) {
    if (error instanceof HarnessBlockedError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new HarnessBlockedError(
      [harnessReviewEvidenceRejectedBlocker(reviewCommand, detail)],
      detail,
    );
  }
}

if (import.meta.main) {
  const reviewCommand =
    process.argv[2] === "context"
      ? ("harness:review-context" as const)
      : ("harness:review-evidence" as const);
  process.exitCode = await runHarnessCliBoundary({
    source: { kind: "command", id: reviewCommand },
    reproduce: ["bun", "run", reviewCommand, ...process.argv.slice(3)],
    run: () => runHarnessReviewEvidenceCli(reviewCommand),
  });
}

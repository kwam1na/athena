import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { captureStableHarnessCandidate } from "./harness-candidate";
import {
  HARNESS_GATE_REGISTRY,
  type HistoricalReviewProviderId,
  type HarnessProviderId,
} from "./harness-gate-registry";
import {
  publishHarnessObligationRecord,
  resolveHarnessObligationStorageContext,
  type HarnessObligationCandidateBinding,
} from "./harness-obligation-records";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";

export const HARNESS_REVIEW_MANIFEST_SCHEMA_VERSION = 1;
export const HARNESS_REVIEWER_ARTIFACT_SCHEMA_VERSION = 1;
type ApprovedReviewProviderId = HistoricalReviewProviderId;

type FinalReviewFinding = {
  id: string;
  actionable: boolean;
  blocking: boolean;
  disposition:
    "resolved" | "advisory" | "pre_existing" | "unresolved" | "ignored";
};

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
        ![
          "resolved",
          "advisory",
          "pre_existing",
          "unresolved",
          "ignored",
        ].includes(finding.disposition),
    )
  ) {
    throw new Error("review manifest contains an invalid finding");
  }
  if (
    findings.some(
      (finding) =>
        finding.blocking ||
        (finding.actionable &&
          !["resolved", "pre_existing"].includes(finding.disposition)),
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
 * Recording compares the same deliverable identity the gate later compares, so
 * an approval survives a landed-change report or solution note committed after
 * the final pass. Everything a reviewer read still has to be identical.
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
      },
    },
    { storageDir: options.storageDir, now: options.now },
  );
}

export async function collectHarnessReviewContext(rootDir: string) {
  const [captured, storage] = await Promise.all([
    defaultCaptureCandidate(rootDir),
    resolveHarnessObligationStorageContext(rootDir, {}),
  ]);
  if (!captured.ok) {
    throw new Error(`Current candidate cannot be verified: ${captured.reason}`);
  }
  return { worktreeId: storage.worktreeId, candidate: captured.candidate };
}

async function main() {
  const [command, manifestPath] = process.argv.slice(2);
  if (command === "context" && !manifestPath) {
    console.log(
      JSON.stringify(await collectHarnessReviewContext(process.cwd())),
    );
    return;
  }
  if (command !== "record" || !manifestPath || process.argv.length !== 4) {
    throw new Error(
      "Usage: bun scripts/harness-review-evidence.ts <context|record finalized-manifest-path>",
    );
  }
  const result = await recordHarnessReviewEvidence(process.cwd(), manifestPath);
  console.log(
    JSON.stringify({
      kind: "review_evidence_recorded",
      recordId: result.recordId,
      path: result.path,
    }),
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

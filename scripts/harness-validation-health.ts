import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Qualification contract only. Call again at admission; never persist an eligible
 * decision as authorization for another candidate, profile, or health revision.
 * Policy and proof inputs must come from protected-base policy and the product's
 * evidence verifier, respectively, never from candidate-authored JSON.
 */
export type HealthScope =
  | { kind: "repo" }
  | { kind: "package"; package: string }
  | { kind: "paths"; package: string; paths: string[] };

export type HealthPolicy = {
  repository: string;
  defaultBranch: string;
  workflowId: number;
  workflowPath: string;
  artifactName: string;
  /** Maintainer-approved classifications versioned on protected main. Required
   * file, including an empty entries list, is created by the later CI owner. */
  classificationPath: string;
  checks: Array<{ checkId: string; scope: HealthScope }>;
};
export type HealthFinding = {
  id: string;
  revision: string;
  checkId: string;
  scope: HealthScope;
  runId: number;
  headSha: string;
};
export type HealthRunResult = {
  runId: number;
  headSha: string;
  outcome: string;
  completedAt: number;
};
export type HealthAvailability =
  | "available"
  | "missing-seed"
  | "api-unavailable"
  | "artifact-unavailable"
  | "invalid-health"
  | "incomplete"
  | "overdue";
export type HealthSnapshot = {
  schemaVersion: "athena-validation-health/1";
  revision: string;
  observedAt: number;
  availability: HealthAvailability;
  lastAttempt?: HealthRunResult;
  lastComplete?: HealthRunResult;
  findings: HealthFinding[];
  closedFindings: Array<{
    finding: HealthFinding;
    reference: string;
    mainSha: string;
    revalidationRunId: number;
  }>;
};
/** A verified execution result supplied by the product, not a receipt parser.
 * A hosted proof must have passed the host's provenance verification. */
export type RepairProof = {
  candidateRef: string;
  profile: "local" | "hosted";
  healthRevision: string;
  findingId: string;
  findingRevision: string;
  checkId: string;
  scope: HealthScope;
  outcome: "success" | "failure";
  evidenceRef: string;
};
export type FullValidationProof = Pick<
  RepairProof,
  "candidateRef" | "profile" | "healthRevision" | "outcome" | "evidenceRef"
> & { mode: "full-health" };

export type HealthCandidate = {
  candidateRef: string;
  profile: "local" | "hosted";
  /** Empty means unknown impact and therefore intersects every finding. */
  scopes: HealthScope[];
};
export type HealthDecision = {
  status: "eligible" | "repair-required" | "health-unavailable";
  reason: string;
  healthRevision: string;
  reevaluationRequired: boolean;
  obligations: Array<{
    finding: HealthFinding;
    discharged: boolean;
    evidenceRef?: string;
  }>;
  recovery?: { mode: "full-health"; retainFindings: true };
};
export const HEALTH_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const HEALTH_READ_TIMEOUT_MS = 30_000;

function covers(outer: HealthScope, inner: HealthScope): boolean {
  if (outer.kind === "repo") return true;
  if (inner.kind === "repo" || outer.package !== inner.package) return false;
  if (outer.kind === "package") return true;
  return (
    inner.kind === "paths" && inner.paths.every((p) => outer.paths.includes(p))
  );
}
function intersects(a: HealthScope, b: HealthScope): boolean {
  if (a.kind === "repo" || b.kind === "repo") return true;
  if (a.package !== b.package) return false;
  return (
    a.kind === "package" ||
    b.kind === "package" ||
    a.paths.some((p) => b.paths.includes(p))
  );
}

export function evaluateValidationHealth(input: {
  health: HealthSnapshot;
  candidate: HealthCandidate;
  /** Results must already be verified by the delivery product. */
  proofs?: RepairProof[];
  plannedHealthRevision?: string;
  /** Product-verified complete inventory proof; never selected/partial coverage. */
  fullValidation?: FullValidationProof;
  now?: number;
}): HealthDecision {
  const { health, candidate } = input;
  const now = input.now ?? Date.now();
  const obligations = health.findings
    .filter(
      (f) =>
        candidate.scopes.length === 0 ||
        candidate.scopes.some((s) => intersects(s, f.scope)),
    )
    .map((finding) => {
      const proof = input.proofs?.find(
        (p) =>
          p.candidateRef === candidate.candidateRef &&
          p.profile === candidate.profile &&
          p.healthRevision === health.revision &&
          p.findingId === finding.id &&
          p.findingRevision === finding.revision &&
          p.checkId === finding.checkId &&
          p.outcome === "success" &&
          nonEmpty(p.evidenceRef) &&
          covers(p.scope, finding.scope),
      );
      return {
        finding,
        discharged: !!proof,
        ...(proof ? { evidenceRef: proof.evidenceRef } : {}),
      };
    });
  const reason =
    health.availability !== "available"
      ? health.availability
      : !health.lastComplete
        ? "missing-seed"
        : !Number.isFinite(now) ||
            !Number.isFinite(health.lastComplete.completedAt) ||
            health.lastComplete.completedAt > now
          ? "invalid-health"
          : now - health.lastComplete.completedAt >= HEALTH_MAX_AGE_MS
            ? "overdue"
            : obligations.some((o) => !o.discharged)
              ? "intersecting-failure"
              : "requirements-satisfied";
  const unavailable = ![
    "intersecting-failure",
    "requirements-satisfied",
  ].includes(reason);
  const full = input.fullValidation;
  const recovered =
    unavailable &&
    full?.mode === "full-health" &&
    full.candidateRef === candidate.candidateRef &&
    full.profile === candidate.profile &&
    full.healthRevision === health.revision &&
    full.outcome === "success" &&
    nonEmpty(full.evidenceRef);
  return {
    status:
      unavailable && !recovered
        ? "health-unavailable"
        : obligations.some((o) => !o.discharged)
          ? "repair-required"
          : "eligible",
    reason: recovered ? "explicit-full-validation" : reason,
    healthRevision: health.revision,
    reevaluationRequired:
      input.plannedHealthRevision !== undefined &&
      input.plannedHealthRevision !== health.revision &&
      (unavailable || obligations.length > 0),
    obligations,
    ...(unavailable
      ? {
          recovery: {
            mode: "full-health" as const,
            retainFindings: true as const,
          },
        }
      : {}),
  };
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function isSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}
function validScope(value: unknown): value is HealthScope {
  return (
    record(value) &&
    (value.kind === "repo" ||
      (nonEmpty(value.package) &&
        (value.kind === "package" ||
          (value.kind === "paths" &&
            Array.isArray(value.paths) &&
            value.paths.length > 0 &&
            value.paths.every(
              (p) =>
                nonEmpty(p) &&
                !p.startsWith("/") &&
                !p.split("/").includes(".."),
            )))))
  );
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
class HealthReadError extends Error {
  constructor(readonly availability: HealthAvailability) {
    super(availability);
  }
}

type Run = {
  id: number;
  run_attempt: number;
  workflow_id: number;
  path: string;
  head_branch: string;
  head_sha: string;
  event: string;
  status: string;
  conclusion: string | null;
  updated_at: string;
};
function trustedRun(value: unknown, policy: HealthPolicy): value is Run {
  return (
    record(value) &&
    positive(value.id) &&
    positive(value.run_attempt) &&
    value.workflow_id === policy.workflowId &&
    value.path === policy.workflowPath &&
    value.head_branch === policy.defaultBranch &&
    isSha(value.head_sha) &&
    ["schedule", "workflow_dispatch", "push"].includes(String(value.event)) &&
    nonEmpty(value.status) &&
    (value.conclusion === null || nonEmpty(value.conclusion)) &&
    typeof value.updated_at === "string" &&
    Number.isFinite(Date.parse(value.updated_at)) &&
    record(value.repository) &&
    value.repository.full_name === policy.repository &&
    record(value.head_repository) &&
    value.head_repository.full_name === policy.repository
  );
}
function runResult(run: Run): HealthRunResult {
  return {
    runId: run.id,
    headSha: run.head_sha,
    outcome:
      run.status === "completed" ? (run.conclusion ?? "unknown") : run.status,
    completedAt: Date.parse(run.updated_at),
  };
}

/** Each artifact is a cumulative ledger: omitted historical findings do not
 * constitute closure. The writer carries findings across full runs; readers
 * additionally retain their previous snapshot. Only approved main resolutions
 * plus successful trusted revalidation remove an open finding. */
export type HealthDigest = {
  schemaVersion: "athena-validation-health-digest/1";
  repository: string;
  runId: number;
  runAttempt: number;
  headSha: string;
  complete: boolean;
  checks: Array<{
    checkId: string;
    outcome: "success" | "failure" | "cancelled" | "unavailable";
  }>;
  findings: Array<Omit<HealthFinding, "scope">>;
};
function parseDigest(
  value: unknown,
  run: Run,
  policy: HealthPolicy,
): HealthDigest {
  const fail = () => {
    throw new HealthReadError("invalid-health");
  };
  if (
    !record(value) ||
    value.schemaVersion !== "athena-validation-health-digest/1" ||
    value.repository !== policy.repository ||
    value.runId !== run.id ||
    value.runAttempt !== run.run_attempt ||
    value.headSha !== run.head_sha ||
    typeof value.complete !== "boolean" ||
    !Array.isArray(value.checks) ||
    !Array.isArray(value.findings)
  )
    return fail();
  const checks = value.checks;
  if (
    !checks.every(
      (c) =>
        record(c) &&
        nonEmpty(c.checkId) &&
        ["success", "failure", "cancelled", "unavailable"].includes(
          String(c.outcome),
        ),
    ) ||
    new Set(checks.map((c) => c.checkId)).size !== checks.length ||
    checks.some((c) => !policy.checks.some((p) => p.checkId === c.checkId))
  )
    return fail();
  if (
    value.complete &&
    (checks.length !== policy.checks.length ||
      checks.some((c) => !["success", "failure"].includes(c.outcome)))
  )
    return fail();
  if (
    run.conclusion === "success" &&
    (!value.complete || checks.some((c) => c.outcome !== "success"))
  )
    return fail();
  if (
    !value.findings.every(
      (f) =>
        record(f) &&
        nonEmpty(f.id) &&
        nonEmpty(f.revision) &&
        nonEmpty(f.checkId) &&
        positive(f.runId) &&
        isSha(f.headSha),
    ) ||
    new Set(value.findings.map((f) => f.id)).size !== value.findings.length
  )
    return fail();
  if (
    run.conclusion === "failure" &&
    value.complete &&
    !checks.some((c) => c.outcome === "failure")
  )
    return fail();
  const digestFindings = value.findings as RecordValue[];
  if (
    checks.some(
      (c) =>
        c.outcome === "failure" &&
        !digestFindings.some(
          (f) =>
            f.checkId === c.checkId &&
            f.runId === run.id &&
            f.headSha === run.head_sha,
        ),
    )
  )
    return fail();
  return value as HealthDigest;
}

export type HealthClassification = {
  findingId: string;
  findingRevision: string;
  reference: string;
  /** A main-approved scope classification can localize a known failure. */
  scope?: HealthScope;
  /** Global closure also requires this trusted main run to pass the failed
   * check under the complete policy inventory, after the originating run. */
  revalidationRunId?: number;
};
export type HealthReaderOptions = {
  /** Total wall-clock budget, including approval and artifact reads (1–60000ms). */
  timeoutMs?: number;
  /** Trusted host capability verifying maintainer approval for this exact
   * classification on pinned main. Main membership alone is not approval.
   * Missing/false capability preserves conservative scope and global findings. */
  verifyClassificationApproval?: (
    classification: HealthClassification,
    pinnedMainSha: string,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  requestJson?: (endpoint: string, signal?: AbortSignal) => Promise<unknown>;
  loadArtifact?: (
    repository: string,
    artifactId: number,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  previous?: HealthSnapshot;
  now?: number;
};

/** Reads only GitHub-authenticated default-branch workflow artifacts and a
 * classification document fetched at the current main commit. No scheduling,
 * policy activation, global writes, or candidate classification loading. */
export async function readValidationHealth(
  policy: HealthPolicy,
  options: HealthReaderOptions = {},
): Promise<HealthSnapshot> {
  const controller = new AbortController();
  const signal = controller.signal;
  const timeoutMs = options.timeoutMs ?? HEALTH_READ_TIMEOUT_MS;
  const validTimeout =
    Number.isFinite(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60_000;
  const deadline = setTimeout(
    () => controller.abort(),
    validTimeout ? timeoutMs : HEALTH_READ_TIMEOUT_MS,
  );
  const request = options.requestJson
    ? (endpoint: string) =>
        abortable(() => options.requestJson!(endpoint, signal), signal)
    : async (endpoint: string) => {
        const result = await runHealthProcess(["gh", "api", endpoint], signal);
        if (result.exitCode !== 0) throw new HealthReadError("api-unavailable");
        return JSON.parse(result.stdout.toString("utf8")) as unknown;
      };
  const load = options.loadArtifact
    ? (repository: string, artifactId: number) =>
        abortable(
          () => options.loadArtifact!(repository, artifactId, signal),
          signal,
        )
    : (repository: string, artifactId: number) =>
        loadHealthArtifact(repository, artifactId, signal);
  const now = options.now ?? Date.now();
  const findings = new Map(
    (options.previous?.findings ?? []).map((f) => [
      f.id,
      {
        ...f,
        scope: policy.checks.find((c) => c.checkId === f.checkId)?.scope ?? {
          kind: "repo" as const,
        },
      },
    ]),
  );
  const closedFindings = [...(options.previous?.closedFindings ?? [])];
  let lastAttempt = options.previous?.lastAttempt;
  let lastComplete = options.previous?.lastComplete;
  let availability: HealthAvailability = "available";
  let mainSha: string | undefined;
  const bindings: unknown[] = [];
  try {
    if (!validTimeout) throw new HealthReadError("invalid-health");
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(policy.repository) ||
      !nonEmpty(policy.defaultBranch) ||
      !positive(policy.workflowId) ||
      !nonEmpty(policy.workflowPath) ||
      !nonEmpty(policy.artifactName) ||
      !nonEmpty(policy.classificationPath) ||
      policy.checks.length === 0 ||
      !policy.checks.every((c) => nonEmpty(c.checkId) && validScope(c.scope)) ||
      new Set(policy.checks.map((c) => c.checkId)).size !== policy.checks.length
    )
      throw new HealthReadError("invalid-health");
    const base = `/repos/${policy.repository}`;
    const main = await request(
      `${base}/commits/${encodeURIComponent(policy.defaultBranch)}`,
    );
    if (!record(main) || !isSha(main.sha))
      throw new HealthReadError("invalid-health");
    mainSha = main.sha;
    const content = await request(
      `${base}/contents/${policy.classificationPath.split("/").map(encodeURIComponent).join("/")}?ref=${mainSha}`,
    );
    if (
      !record(content) ||
      content.encoding !== "base64" ||
      typeof content.content !== "string"
    )
      throw new HealthReadError("invalid-health");
    let classification: unknown;
    try {
      classification = JSON.parse(
        Buffer.from(content.content, "base64").toString("utf8"),
      );
    } catch {
      throw new HealthReadError("invalid-health");
    }
    if (
      !record(classification) ||
      classification.schemaVersion !== "athena-health-classifications/1" ||
      !Array.isArray(classification.entries) ||
      !classification.entries.every(
        (e) =>
          record(e) &&
          nonEmpty(e.findingId) &&
          nonEmpty(e.findingRevision) &&
          nonEmpty(e.reference) &&
          (e.scope === undefined || validScope(e.scope)) &&
          (e.revalidationRunId === undefined || positive(e.revalidationRunId)),
      )
    )
      throw new HealthReadError("invalid-health");
    const classifications = classification.entries as HealthClassification[];
    if (
      new Set(classifications.map((c) => `${c.findingId}:${c.findingRevision}`))
        .size !== classifications.length
    )
      throw new HealthReadError("invalid-health");
    bindings.push(classification);
    const runs: Run[] = [];
    // Fetch enough history to find the last complete run, including cancelled
    // attempts. Never interpret a truncated API page as an empty healthy seed.
    let reachedOverdueHistory = false;
    for (let page = 1; page <= 20 && !reachedOverdueHistory; page++) {
      const list = await request(
        `${base}/actions/workflows/${policy.workflowId}/runs?branch=${encodeURIComponent(policy.defaultBranch)}&per_page=100&page=${page}`,
      );
      if (
        !record(list) ||
        !Array.isArray(list.workflow_runs) ||
        !Number.isSafeInteger(list.total_count)
      )
        throw new HealthReadError("invalid-health");
      for (const item of list.workflow_runs) {
        if (!trustedRun(item, policy)) continue;
        runs.push(item);
        if (Date.parse(item.updated_at) <= now - HEALTH_MAX_AGE_MS)
          reachedOverdueHistory = true;
      }
      if (page * 100 >= (list.total_count as number)) break;
      if (page === 20 && !reachedOverdueHistory)
        throw new HealthReadError("incomplete");
    }
    runs.sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt);
    if (runs.length === 0) throw new HealthReadError("missing-seed");
    lastAttempt = runResult(runs[0]);
    const observed = new Map<number, { run: Run; digest: HealthDigest }>();
    const readRunDigest = async (run: Run): Promise<HealthDigest> => {
      const artifacts = await request(
        `${base}/actions/runs/${run.id}/artifacts?per_page=100`,
      );
      if (
        !record(artifacts) ||
        !Array.isArray(artifacts.artifacts) ||
        !Number.isSafeInteger(artifacts.total_count) ||
        (artifacts.total_count as number) > 100
      )
        throw new HealthReadError("artifact-unavailable");
      const matches = artifacts.artifacts.filter(
        (a) => record(a) && a.name === policy.artifactName,
      );
      if (matches.length !== 1)
        throw new HealthReadError("artifact-unavailable");
      const artifact = matches[0] as RecordValue;
      if (
        !positive(artifact.id) ||
        artifact.expired !== false ||
        !record(artifact.workflow_run) ||
        artifact.workflow_run.id !== run.id ||
        artifact.workflow_run.head_sha !== run.head_sha
      )
        throw new HealthReadError("artifact-unavailable");
      const digest = parseDigest(
        await load(policy.repository, artifact.id),
        run,
        policy,
      );
      observed.set(run.id, { run, digest });
      bindings.push({
        runId: run.id,
        attempt: run.run_attempt,
        artifactId: artifact.id,
        digest,
      });
      return digest;
    };
    // Newer partial attempts can report failures; the first complete digest
    // provides the cumulative history. Do not read expired older superseded
    // artifacts merely to rediscover already-carried history.
    for (const run of runs) {
      if (
        run.status !== "completed" ||
        !["success", "failure"].includes(run.conclusion ?? "")
      )
        continue;
      const digest = await readRunDigest(run);
      for (const f of digest.findings) {
        const existing = findings.get(f.id);
        // API observations may arrive out of order. Never roll a retained
        // failure back or silently rewrite an immutable originating finding.
        if (existing && existing.runId > f.runId) continue;
        if (
          existing &&
          existing.runId === f.runId &&
          (existing.revision !== f.revision ||
            existing.checkId !== f.checkId ||
            existing.headSha !== f.headSha)
        ) {
          throw new HealthReadError("invalid-health");
        }
        findings.set(f.id, {
          ...f,
          scope: policy.checks.find((c) => c.checkId === f.checkId)?.scope ?? {
            kind: "repo",
          },
        });
      }
      if (digest.complete) {
        lastComplete = runResult(run);
        break;
      }
    }
    if (observed.size === 0)
      throw new HealthReadError(lastComplete ? "incomplete" : "missing-seed");
    for (const [id, finding] of findings) {
      const approval = classifications.find(
        (c) => c.findingId === id && c.findingRevision === finding.revision,
      );
      if (
        !approval ||
        !options.verifyClassificationApproval ||
        (await abortable(
          () =>
            options.verifyClassificationApproval!(approval, mainSha!, signal),
          signal,
        )) !== true
      )
        continue;
      if (approval.scope) finding.scope = approval.scope;
      if (
        !approval.revalidationRunId ||
        approval.revalidationRunId <= finding.runId
      )
        continue;
      let revalidation = observed.get(approval.revalidationRunId);
      if (!revalidation) {
        const historical: unknown =
          runs.find((run) => run.id === approval.revalidationRunId) ??
          (await request(`${base}/actions/runs/${approval.revalidationRunId}`));
        if (
          !trustedRun(historical, policy) ||
          historical.id !== approval.revalidationRunId ||
          historical.status !== "completed" ||
          !["success", "failure"].includes(historical.conclusion ?? "")
        ) {
          throw new HealthReadError("invalid-health");
        }
        revalidation = {
          run: historical,
          digest: await readRunDigest(historical),
        };
      }
      if (
        revalidation &&
        revalidation.run.id > finding.runId &&
        revalidation.digest.complete &&
        revalidation.digest.checks.some(
          (c) => c.checkId === finding.checkId && c.outcome === "success",
        )
      ) {
        const comparison = await request(
          `${base}/compare/${revalidation.run.head_sha}...${mainSha}`,
        );
        if (
          !record(comparison) ||
          !["ahead", "identical"].includes(String(comparison.status))
        )
          continue;
        findings.delete(id);
        if (
          !closedFindings.some(
            (c) =>
              c.finding.id === finding.id &&
              c.finding.revision === finding.revision &&
              c.revalidationRunId === revalidation.run.id &&
              c.reference === approval.reference,
          )
        ) {
          closedFindings.push({
            finding,
            reference: approval.reference,
            mainSha,
            revalidationRunId: revalidation.run.id,
          });
        }
      }
    }
    if (!lastComplete) throw new HealthReadError("incomplete");
    if (lastComplete.completedAt > now || lastAttempt.completedAt > now)
      throw new HealthReadError("invalid-health");
    if (now - lastComplete.completedAt >= HEALTH_MAX_AGE_MS)
      throw new HealthReadError("overdue");
  } catch (error) {
    availability =
      error instanceof HealthReadError ? error.availability : "api-unavailable";
  } finally {
    clearTimeout(deadline);
  }
  const retained = [...findings.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return {
    schemaVersion: "athena-validation-health/1",
    revision: hash({
      policy,
      availability,
      bindings,
      lastAttempt,
      lastComplete,
      findings: retained,
      closedFindings,
    }),
    observedAt: now,
    availability,
    lastAttempt,
    lastComplete,
    findings: retained,
    closedFindings,
  };
}

function abortable<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new HealthReadError("api-unavailable"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new HealthReadError("api-unavailable"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
}

/** Own and reap the process group before returning on cancellation. Download
 * output can go directly to a temporary archive without buffering the ZIP. */
export async function runHealthProcess(
  command: string[],
  signal: AbortSignal,
  stdoutPath?: string,
): Promise<{ exitCode: number | null; stdout: Buffer }> {
  if (signal.aborted) throw new HealthReadError("api-unavailable");
  const output =
    stdoutPath === undefined ? undefined : openSync(stdoutPath, "w");
  try {
    const child = spawn(command[0], command.slice(1), {
      detached: process.platform !== "win32",
      stdio: ["ignore", output ?? "pipe", "pipe"],
      env: {
        ...process.env,
        ...(process.env.GITHUB_TOKEN && !process.env.GH_TOKEN
          ? { GH_TOKEN: process.env.GITHUB_TOKEN }
          : {}),
      },
    });
    return await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      child.stdout?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      child.stderr?.resume();
      const abort = () => {
        try {
          if (child.pid && process.platform !== "win32")
            process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            child.kill("SIGKILL");
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      });
      child.once("close", (exitCode) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(new HealthReadError("api-unavailable"));
        else resolve({ exitCode, stdout: Buffer.concat(chunks) });
      });
      if (signal.aborted) abort();
    });
  } finally {
    if (output !== undefined) closeSync(output);
  }
}

async function loadHealthArtifact(
  repository: string,
  artifactId: number,
  signal: AbortSignal,
): Promise<unknown> {
  const directory = await mkdtemp(path.join(tmpdir(), "athena-health-"));
  try {
    const archive = path.join(directory, "health.zip");
    const download = await runHealthProcess(
      ["gh", "api", `/repos/${repository}/actions/artifacts/${artifactId}/zip`],
      signal,
      archive,
    );
    if (download.exitCode !== 0)
      throw new HealthReadError("artifact-unavailable");
    // Read one fixed member to stdout; never extract paths supplied by a ZIP.
    const unzip = await runHealthProcess(
      ["unzip", "-p", archive, "health.json"],
      signal,
    );
    if (unzip.exitCode !== 0) throw new HealthReadError("artifact-unavailable");
    try {
      return JSON.parse(unzip.stdout.toString("utf8"));
    } catch {
      throw new HealthReadError("invalid-health");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

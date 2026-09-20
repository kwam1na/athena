import type {
  ScopedAttemptDiagnostic,
  readScopedCheckDiagnostics,
} from "../.agent-skills/current/runtime/cli-api.mjs";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  digestCanonical,
  type HarnessConfig,
} from "../.agent-skills/current/runtime/kernel.mjs";
import type {
  NativeValidationInput,
  NativeValidationResult,
  NativeValidationObservations,
} from "./harness-validation-native";
import type { NativeValidationSelection } from "./harness-validation-load";
import type { HostedValidationBinding } from "./harness-validation-ci-binding";
import type { ValidationPlan } from "./harness-validation-plan";

type Attempt =
  NativeValidationObservations["providers"][number]["attempts"][number];
export type AttemptDiagnostic = ScopedAttemptDiagnostic;
export type ReadDiagnostics = typeof readScopedCheckDiagnostics;
export type DiagnosticRow = {
  checkId: string;
  coveredCheckIds: string[];
  providerId?: string;
  profile: string;
  cwd: string;
  commandDigest: string;
  command?: string[];
  commandOmitted?: boolean;
  membershipCount: number;
  attempt?: Attempt;
  diagnostic?: AttemptDiagnostic;
  unavailable?: string;
};
export type ValidationDiagnostics = {
  version: "athena-validation-diagnostics/1";
  authority: "diagnostic-only";
  binding: HostedValidationBinding;
  planDigest: string;
  mode: string;
  candidateTree?: string;
  native: { status: string; phase: string; exitCode: number | null };
  rows: DiagnosticRow[];
  truncated: boolean;
  omittedRows: number;
  unavailable?: string;
};
const hash = digestCanonical;
const bindingOf = (attempt: Attempt) => ({
  providerId: attempt.providerId,
  attemptId: attempt.attemptId,
  generation: attempt.generation,
  inputDigest: attempt.inputDigest,
  profileDigest: attempt.profileDigest,
  status: attempt.status,
  origin: attempt.origin,
});
const phases = new Set([
  "snapshot-setup",
  "pre-command-verification",
  "command",
  "post-command-verification",
  "output-capture",
  "complete",
]);
// Copy only the agreed public fields. Never export unknown fields or error messages.
const failureCodes = new Set([
  "check_snapshot_interrupted",
  "check_snapshot_timeout",
  "check_snapshot_unavailable",
  "check_snapshot_escape",
  "check_snapshot_drift",
  "check_snapshot_cleanup_failed",
  "check_dependency_source_overlap",
  "check_dependency_failed",
  "check_command_failed",
  "check_output_missing",
  "check_attempt_superseded",
  "check_artifact_unavailable",
  "check_evidence_rejected",
]);
const executionCodes = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ABORT_ERR",
  "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  "SIGKILL",
  "SIGTERM",
  "execution_failed",
]);
function diagnostic(value: AttemptDiagnostic): AttemptDiagnostic | undefined {
  if (value.availability === "unavailable")
    return ["legacy", "running"].includes(value.reason)
      ? { availability: "unavailable", reason: value.reason }
      : undefined;
  if (value.availability !== "available" || !phases.has(value.phase)) return;
  const failure =
    "code" in value.failure
      ? failureCodes.has(value.failure.code)
        ? { code: value.failure.code }
        : undefined
      : ["not-failed", "unclassified"].includes(value.failure.unavailable)
        ? { unavailable: value.failure.unavailable }
        : undefined;
  if (
    failure &&
    "code" in value.failure &&
    value.failure.executionErrorCode !== undefined
  ) {
    if (!executionCodes.has(value.failure.executionErrorCode)) return;
    Object.assign(failure, {
      executionErrorCode: value.failure.executionErrorCode,
    });
  }
  const command =
    "unavailable" in value.command
      ? ["not-started", "not-completed"].includes(value.command.unavailable)
        ? { unavailable: value.command.unavailable }
        : undefined
      : (value.command.exitCode === null ||
            (Number.isSafeInteger(value.command.exitCode) &&
              value.command.exitCode >= 0)) &&
          typeof value.command.outputTail === "string" &&
          value.command.outputTail.length <= 4000 &&
          typeof value.command.truncated === "boolean"
        ? {
            exitCode: value.command.exitCode,
            outputTail: value.command.outputTail,
            truncated: value.command.truncated,
          }
        : undefined;
  if (failure && command)
    return { availability: "available", phase: value.phase, failure, command };
}
export function unavailableDiagnostics(
  plan: ValidationPlan,
  binding: HostedValidationBinding,
  reason: string,
): ValidationDiagnostics {
  return {
    version: "athena-validation-diagnostics/1",
    authority: "diagnostic-only",
    binding: { ...binding },
    planDigest: plan.digest,
    mode: plan.mode,
    native: { status: "unavailable", phase: "capture", exitCode: null },
    rows: [],
    truncated: false,
    omittedRows: 0,
    unavailable: reason,
  };
}
export async function collectValidationDiagnostics(input: {
  rootDir: string;
  plan: ValidationPlan;
  binding: HostedValidationBinding;
  selection: NativeValidationSelection;
  nativeInput?: NativeValidationInput;
  result?: NativeValidationResult;
  read: ReadDiagnostics;
}): Promise<ValidationDiagnostics> {
  const { plan, binding, result, nativeInput, selection } = input;
  const report = unavailableDiagnostics(plan, binding, "no-native-result");
  delete report.unavailable;
  report.candidateTree = selection.candidate.treeSha;
  report.native = {
    status: result?.status ?? "unavailable",
    phase:
      result?.status === "failed"
        ? result.phase
        : result
          ? "complete"
          : "capture",
    exitCode: result?.status === "failed" ? result.exitCode : result ? 0 : null,
  };
  const nativeCandidate = result?.candidate;
  const nativeBound =
    nativeCandidate &&
    nativeCandidate.headSha === binding.headSha &&
    nativeCandidate.treeSha === selection.candidate.treeSha &&
    nativeCandidate.base.tipSha === binding.baseSha &&
    nativeCandidate.deliverable.identity ===
      nativeInput?.config.computingIdentityVersion;
  const prior = new Set(
    result?.beforeObservations.providers.flatMap((p) =>
      p.attempts.map((a) => a.attemptId),
    ) ?? [],
  );
  const attempts = new Map<string, Attempt>();
  report.rows = plan.checks.map((check) => {
    const providerId = nativeInput?.checkIdToProviderId[check.id];
    const matching =
      result?.observations.providers
        .find((p) => p.providerId === providerId)
        ?.attempts.filter(
          (a) =>
            nativeBound &&
            !prior.has(a.attemptId) &&
            a.providerId === providerId &&
            a.origin.candidate.treeSha === selection.candidate.treeSha &&
            a.origin.candidate.baseTipSha === binding.baseSha &&
            a.origin.candidate.identityToken ===
              nativeInput?.config.computingIdentityVersion &&
            a.origin.candidate.deliverableDigest ===
              nativeCandidate.deliverable.digest &&
            a.origin.candidate.baseRef === nativeCandidate.base.ref &&
            a.origin.candidate.mergeBaseSha ===
              nativeCandidate.base.mergeBaseSha &&
            a.origin.candidate.workspaceId === nativeCandidate.workspaceId,
        )
        .sort((a, b) => b.generation - a.generation) ?? [];
    const attempt = matching[0];
    if (attempt) attempts.set(attempt.attemptId, attempt);
    const command =
      nativeInput?.config.providers.find((p) => p.id === providerId)?.check
        ?.command ?? check.argv;
    return {
      checkId: check.id,
      coveredCheckIds: [...check.coveredChecks],
      providerId,
      profile: check.profile,
      cwd: check.cwd,
      commandDigest: hash(command),
      ...(Buffer.byteLength(JSON.stringify(command)) <= 8192
        ? { command: [...command] }
        : { commandOmitted: true }),
      membershipCount: check.membership.length,
      ...(attempt
        ? {
            attempt: {
              version: attempt.version,
              ...structuredClone(bindingOf(attempt)),
              ...(attempt.durationMs === undefined
                ? {}
                : { durationMs: attempt.durationMs }),
            },
          }
        : {
            unavailable:
              result && !nativeBound
                ? "native-candidate-unavailable"
                : "no-new-attempt",
          }),
    };
  });
  const found = new Map<string, AttemptDiagnostic>();
  let readUnavailable: string | undefined;
  const ids = [...attempts.keys()].sort();
  for (let i = 0; i < ids.length; i += 100) {
    const requested = ids.slice(i, i + 100);
    try {
      const data = await input.read({
        rootDir: input.rootDir,
        config: nativeInput!.config,
        attemptIds: requested,
      });
      if (data.version !== "scoped-check-diagnostics/1")
        throw new Error("Unsupported diagnostics");
      const seen = new Set<string>();
      const batch = new Map<string, AttemptDiagnostic>();
      for (const provider of data.providers)
        for (const row of provider.attempts) {
          const expected = attempts.get(row.attemptId);
          if (
            !requested.includes(row.attemptId) ||
            seen.has(row.attemptId) ||
            !expected ||
            provider.providerId !== expected.providerId ||
            hash(bindingOf(row)) !== hash(bindingOf(expected))
          )
            throw new Error("Unbound diagnostics");
          seen.add(row.attemptId);
          const safe = diagnostic(row.diagnostic);
          if (!safe) throw new Error("Malformed diagnostics");
          batch.set(row.attemptId, safe);
        }
      for (const id of data.unavailableAttemptIds) {
        if (!requested.includes(id) || seen.has(id))
          throw new Error("Unbound unavailable attempt");
        seen.add(id);
      }
      if (seen.size !== requested.length)
        throw new Error("Incomplete diagnostics");
      for (const [id, row] of batch) found.set(id, row);
    } catch {
      readUnavailable = "diagnostic-read-unavailable";
    }
  }
  for (const row of report.rows)
    if (row.attempt) {
      const value = found.get(row.attempt.attemptId);
      if (value) row.diagnostic = value;
      else
        row.unavailable = readUnavailable ?? "attempt-diagnostics-unavailable";
    }
  return boundValidationDiagnostics(report);
}
export function boundValidationDiagnostics(
  report: ValidationDiagnostics,
): ValidationDiagnostics {
  const bounded = structuredClone(report);
  // Retain failing rows first; explicitly report anything omitted by the artifact cap.
  bounded.rows.sort(
    (a, b) =>
      Number(a.attempt?.status === "passed") -
      Number(b.attempt?.status === "passed"),
  );
  const rows = bounded.rows;
  bounded.rows = [];
  for (const original of rows) {
    const row = { ...original };
    bounded.rows.push(row);
    if (Buffer.byteLength(JSON.stringify(bounded)) > 60 * 1024) {
      delete row.diagnostic;
      row.unavailable = "artifact-limit";
      bounded.truncated = true;
      if (Buffer.byteLength(JSON.stringify(bounded)) > 60 * 1024) {
        bounded.rows.pop();
        bounded.omittedRows++;
      }
    }
  }
  return bounded;
}
export async function diagnosticsDirectory(root: string) {
  let dir = await realpath(root);
  for (const component of ["artifacts", "validation-ci"]) {
    dir = path.join(dir, component);
    const entry = await lstat(dir).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink()))
      throw new Error("Unsafe diagnostic directory");
    if (!entry) await mkdir(dir);
  }
  return dir;
}
export async function writeValidationDiagnostics(
  root: string,
  report: ValidationDiagnostics,
) {
  const dir = await diagnosticsDirectory(root);
  const temporary = path.join(dir, `diagnostics-${randomUUID()}.tmp`);
  try {
    await writeFile(
      temporary,
      JSON.stringify(boundValidationDiagnostics(report)) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporary, path.join(dir, "diagnostics.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}

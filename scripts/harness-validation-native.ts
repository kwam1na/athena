import path from "node:path";
import { lstat, mkdir, realpath } from "node:fs/promises";
import {
  runCli,
  wireRepo,
  readScopedCheckObservations,
  type CliRuntime,
} from "../.agent-skills/current/runtime/cli-api.mjs";
import {
  createArtifactsPort,
  deliveryRecordPathFor,
  parseDeliveryRecord,
  runGitCommand,
  classifyCandidateDrift,
  portableArtifactContents,
  digestCanonical,
  type ScopedCheckAttempt,
  type ScopedRuntimeObservation,
  type CheckBinding,
  type CapturedCandidate,
  type HarnessConfig,
  type DeliveryRecord,
} from "../.agent-skills/current/runtime/kernel.mjs";

export type NativeValidationInput = {
  rootDir: string;
  config: HarnessConfig;
  env: NodeJS.ProcessEnv;
  binding: { headSha: string; baseSha: string };
  checkIdToProviderId: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
};
export type NativeValidationPhase = "prepare" | "gate" | "record" | "verify";
export type NativeValidationObservations = Awaited<
  ReturnType<typeof readScopedCheckObservations>
>;
export const readNativeValidationObservations = readScopedCheckObservations;
type CommonResult = {
  /** Exact public native capture, distinct from the planning policy identity. */
  candidate?: CapturedCandidate;
  observations: NativeValidationObservations;
  beforeObservations: NativeValidationObservations;
  phases: Array<{ phase: NativeValidationPhase; exitCode: number }>;
};
export type VerifiedNativeAttempt = {
  checkId: string;
  providerId: string;
  attempt: ScopedCheckAttempt;
  observation: ScopedRuntimeObservation;
  checkBinding: CheckBinding;
  durationMs?: number;
};
export type NativeValidationResult = CommonResult &
  (
    | {
        status: "verified";
        recordRef: string;
        record: DeliveryRecord;
        selectedAttempts: VerifiedNativeAttempt[];
      }
    | {
        status: "failed";
        phase: NativeValidationPhase | "capture";
        exitCode: number | null;
        error?: string;
      }
  );

/** Called only after public native verify succeeds. Bytes and their binding are
 * product-owned portable evidence, not an uploaded observation/summary receipt. */
function verifiedAttempts(
  record: DeliveryRecord,
  mapping: NativeValidationInput["checkIdToProviderId"],
): VerifiedNativeAttempt[] {
  return Object.entries(mapping).map(([checkId, providerId]) => {
    const evidence = record.claims
      .flatMap((claim) => [
        ...(claim.evidence ? [claim.evidence] : []),
        ...(claim.supportingEvidence ?? []),
      ])
      .filter(
        (row) =>
          row.resolution.kind === "evidence" &&
          row.resolution.providerId === providerId,
      );
    const selected = evidence.map((row) => {
      if (
        row.resolution.kind !== "evidence" ||
        !row.resolution.checkBinding ||
        !row.resolution.portable
      )
        throw new Error(
          "Verified scoped provider lacks portable native evidence",
        );
      const checkBinding = row.resolution.checkBinding;
      const contents = portableArtifactContents(
        row.resolution.portable.artifacts,
      );
      const raw = contents.artifacts.get("scoped-inputs.json");
      if (contents.blockers.length || !raw)
        throw new Error("Verified scoped inputs unavailable");
      // Native verification validated this exact retained artifact and attempt.
      const retained = JSON.parse(raw) as {
        attempt: ScopedCheckAttempt;
        observation: ScopedRuntimeObservation;
        durationMs?: number;
      };
      if (
        retained.attempt.providerId !== providerId ||
        retained.attempt.status !== "passed" ||
        digestCanonical(retained.attempt) !==
          checkBinding.scopedAttemptDigest ||
        retained.attempt.inputDigest !== checkBinding.scopedInputDigest ||
        retained.attempt.profileDigest !== checkBinding.scopedProfileDigest
      )
        throw new Error(
          "Selected native attempt does not match verified check binding",
        );
      return {
        checkId,
        providerId,
        attempt: retained.attempt,
        observation: retained.observation,
        checkBinding,
        ...(retained.durationMs === undefined
          ? {}
          : { durationMs: retained.durationMs }),
      };
    });
    if (
      !selected.length ||
      selected.some(
        (row) =>
          row.checkBinding.scopedAttemptDigest !==
          selected[0].checkBinding.scopedAttemptDigest,
      )
    )
      throw new Error("Missing or ambiguous selected native attempt");
    return selected[0];
  });
}

function validateInput(input: NativeValidationInput) {
  const { config, checkIdToProviderId } = input;
  const providers = config.providers;
  const mapped = new Set(Object.values(checkIdToProviderId));
  if (
    !providers.length ||
    !config.scopedExecution ||
    providers.some((p) => !p.check?.scope || p.command !== undefined) ||
    mapped.size !== providers.length ||
    providers.some((p) => !mapped.has(p.id)) ||
    Object.keys(checkIdToProviderId).some((id) => !id)
  )
    throw new Error("Complete scoped provider mapping is required");
  if (
    !config.obligations.length ||
    config.obligations.some(
      (o) =>
        o.activation.kind !== "always" ||
        o.humanWaiverAllowed ||
        o.acceptedPayloadSpecs.length !== 1 ||
        o.acceptedPayloadSpecs[0] !== "checks.passed/1" ||
        o.allowedResolutionKinds.length !== 1 ||
        o.allowedResolutionKinds[0] !== "satisfied_evidence" ||
        o.providers.some((id) => !mapped.has(id)),
    ) ||
    providers.some(
      (p) => !config.obligations.some((o) => o.providers.includes(p.id)),
    )
  )
    throw new Error("Native CI requires an explicit check-only gate");
  const relative = config.deliveryRecordPath;
  if (
    path.posix.dirname(relative) !== "artifacts/validation-ci" ||
    !relative.startsWith("artifacts/validation-ci/") ||
    relative.includes("\\") ||
    relative.split("/").some((p) => p === ".." || !p)
  )
    throw new Error(
      "Native record must use ignored artifacts/validation-ci transport",
    );
}

async function coordinator(
  input: NativeValidationInput,
  phases: NativeValidationPhase[],
): Promise<NativeValidationResult> {
  validateInput(input);
  const rootDir = await realpath(input.rootDir);
  // Do not follow a candidate-controlled ignored symlink when retaining artifacts.
  let artifactRoot = rootDir;
  for (const component of ["artifacts", "validation-ci", "provider-runs"]) {
    artifactRoot = path.join(artifactRoot, component);
    const entry = await lstat(artifactRoot).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      },
    );
    if (entry?.isSymbolicLink() || (entry && !entry.isDirectory()))
      throw new Error("Unsafe native artifact directory");
    if (!entry) await mkdir(artifactRoot);
  }
  const ignored = await runGitCommand(
    ["git", "check-ignore", "--quiet", input.config.deliveryRecordPath],
    { cwd: rootDir },
  );
  if (ignored.exitCode !== 0)
    throw new Error("Native record transport must be ignored by Git");
  const artifacts = createArtifactsPort({ runRootBase: artifactRoot });
  const runtime: CliRuntime = {
    cwd: rootDir,
    env: input.env,
    loadConfig: async () => input.config,
    artifacts,
    stdinIsTTY: false,
    stdoutIsTTY: false,
    stdout: input.stdout ?? (() => {}),
    stderr: input.stderr ?? (() => {}),
    signal: input.signal,
  };
  const observe = () =>
    readScopedCheckObservations({ rootDir, config: input.config });
  const beforeObservations = await observe();
  const completed: CommonResult["phases"] = [];
  let phase: NativeValidationPhase | "capture" = "capture";
  const wiring = await wireRepo(rootDir, input.config);
  const capture = async (expected?: CapturedCandidate) => {
    const captured = await wiring.captureCandidate();
    if (!captured.ok) throw new Error(JSON.stringify(captured.blockers));
    const candidate = captured.candidate;
    if (
      candidate.headSha !== input.binding.headSha ||
      candidate.base.tipSha !== input.binding.baseSha ||
      candidate.mode !== "clean" ||
      (expected && classifyCandidateDrift(expected, candidate).length)
    )
      throw new Error("Native candidate differs from authenticated binding");
    return candidate;
  };
  let candidate: CapturedCandidate | undefined;
  try {
    const original = await capture();
    candidate = original;
    let verifiedRecordText: string | undefined;
    const recordRef = path.join(
      rootDir,
      deliveryRecordPathFor(input.config, original.deliverable.digest),
    );
    for (const next of phases) {
      phase = next;
      await capture(original);
      const beforeVerify =
        next === "verify" ? await artifacts.readTextFile(recordRef) : undefined;
      const exitCode = await runCli([next], runtime);
      completed.push({ phase: next, exitCode });
      if (exitCode !== 0)
        return {
          status: "failed",
          candidate,
          phase,
          exitCode,
          observations: await observe(),
          beforeObservations,
          phases: completed,
        };
      if (beforeVerify !== undefined) {
        if ((await artifacts.readTextFile(recordRef)) !== beforeVerify)
          throw new Error("Native record changed during verification");
        verifiedRecordText = beforeVerify;
      }
    }
    await capture(original);
    if (verifiedRecordText === undefined)
      throw new Error("Native record was not verified");
    const parsed = parseDeliveryRecord(verifiedRecordText);
    if (!parsed.ok) throw new Error("Verified native record could not be read");
    return {
      status: "verified",
      candidate,
      recordRef,
      record: parsed.record,
      selectedAttempts: verifiedAttempts(
        parsed.record,
        input.checkIdToProviderId,
      ),
      observations: await observe(),
      beforeObservations,
      phases: completed,
    };
  } catch (error) {
    return {
      status: "failed",
      candidate,
      phase,
      exitCode: null,
      error: error instanceof Error ? error.message : String(error),
      observations: await observe(),
      beforeObservations,
      phases: completed,
    };
  }
}

/** Actual product lifecycle, not an interpretation of stdout or uploaded summaries. */
export function runNativeValidation(input: NativeValidationInput) {
  return coordinator(input, ["prepare", "gate", "record", "verify"]);
}
/** Cold trusted verification: never prepares, gates or executes selected checks. */
export function verifyNativeValidation(input: NativeValidationInput) {
  return coordinator(input, ["verify"]);
}

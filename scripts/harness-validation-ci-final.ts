import path from "node:path";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import {
  deliveryRecordPathFor,
  parseDeliveryRecord,
  portableArtifactContents,
  resolveRecordStorage,
  type DeliveryRecord,
  type HarnessConfig,
} from "../.agent-skills/current/runtime/kernel.mjs";
import { wireRepo } from "../.agent-skills/current/runtime/cli-api.mjs";
import { guardValidationCandidate } from "./harness-validation-trust";
import {
  captureCanonicalValidationPlan,
  projectCapturedValidationPlan,
} from "./harness-validation-capture";
import { configureScopedValidation } from "./harness-validation-runtime";
import { createCiValidationConfiguration } from "./harness-validation-ci-policy";
import { verifyNativeValidation } from "./harness-validation-native";
import type { NativeValidationSelection } from "./harness-validation-load";
import type { VerifiedHostedValidation } from "./harness-validation-ci";
import type { JsonRequest } from "./harness-validation-ci-binding";

type Mode = "comparison" | "full-health";
export type FinalValidationPorts = {
  requestJson?: JsonRequest;
  guard?: typeof guardValidationCandidate;
  capture?: (
    root: string,
    config: HarnessConfig,
    mode: Mode,
  ) => Promise<NativeValidationSelection>;
  configure?: typeof configureScopedValidation;
  verify?: typeof verifyNativeValidation;
};

const RECORD = "artifacts/validation-ci/delivery-record.json";
const INVOCATION = "ATHENA_VALIDATION_INVOCATION";
const HEALTH_REVISION = "ATHENA_VALIDATION_HEALTH_REVISION";
const GUARD_PROVIDER = "athena.selection-guard";

function evidence(record: DeliveryRecord, providerId: string) {
  return record.claims
    .flatMap((claim) => [
      ...(claim.evidence ? [claim.evidence] : []),
      ...(claim.supportingEvidence ?? []),
    ])
    .flatMap((row) => {
      if (
        row.resolution.kind !== "evidence" ||
        row.resolution.providerId !== providerId
      )
        return [];
      if (!row.resolution.portable)
        throw new Error("Native portable provider evidence missing");
      const contents = portableArtifactContents(
        row.resolution.portable.artifacts,
      );
      if (contents.blockers.length)
        throw new Error("Invalid portable artifact bytes");
      return [contents.artifacts];
    });
}

function retainedFlags(record: DeliveryRecord, providerId: string) {
  const rows = evidence(record, providerId);
  if (!rows.length)
    throw new Error("Native portable provider evidence missing");
  return rows.map((artifacts) => {
    const text = artifacts.get("scoped-inputs.json");
    if (!text) throw new Error("Native scoped observation missing");
    const flags: unknown = JSON.parse(text)?.observation?.flags;
    if (!flags || typeof flags !== "object" || Array.isArray(flags))
      throw new Error("Native scoped flags missing");
    return flags as Record<string, unknown>;
  });
}

async function readRecord(root: string) {
  let location = root;
  for (const component of RECORD.split("/")) {
    location = path.join(location, component);
    const stat = await lstat(location);
    if (
      stat.isSymbolicLink() ||
      (component === "delivery-record.json"
        ? !stat.isFile()
        : !stat.isDirectory())
    )
      throw new Error("Unsafe native record transport path");
  }
  const bytes = await readFile(location);
  const parsed = parseDeliveryRecord(bytes.toString("utf8"));
  if (!parsed.ok)
    throw new Error("Uploaded artifact is not a native delivery record");
  return { record: parsed.record, bytes };
}

async function assertCold(rootDir: string, config: HarnessConfig) {
  const storage = await resolveRecordStorage(rootDir, {
    storageNamespace: config.storageNamespace,
    leaf: "scoped-attempts",
  });
  const stat = await lstat(storage.storageDir).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (
    stat &&
    (stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (await readdir(storage.storageDir)).length)
  )
    throw new Error("Cold final verification requires no local attempt store");
}

/** Base-owned controller only. Mode and legacyConfig come from trusted controller
 * code/job output, never the uploaded artifact. Ports are trusted test capabilities.
 * Actual job success and fresh health admission remain required by the caller. */
export async function verifyFinalHostedValidation(
  input: {
    baseRoot: string;
    candidateRoot: string;
    legacyConfig: HarnessConfig;
    env: NodeJS.ProcessEnv;
    mode: Mode;
  },
  ports: FinalValidationPorts = {},
) {
  if (!["comparison", "full-health"].includes(input.mode))
    throw new Error("Unsupported trusted final mode");
  if (input.legacyConfig.scopedExecution)
    throw new Error("Trusted base legacy policy required");
  const guard = () =>
    (ports.guard ?? guardValidationCandidate)(
      input.baseRoot,
      input.candidateRoot,
      input.env,
      {
        legacyConfig: input.legacyConfig,
        requestJson: ports.requestJson,
      },
    );
  const requireGuard = (result: Awaited<ReturnType<typeof guard>>) => {
    if (
      result.readiness !== "scoped" ||
      result.reason !== "unchanged-authority" ||
      result.changedControllerPaths.length ||
      !result.selection
    )
      throw new Error(
        "Cold final verification requires unchanged trusted authority",
      );
    return result.selection;
  };
  const guarded = await guard();
  const comparison = requireGuard(guarded);
  const binding = guarded.binding;
  const legacy = { ...input.legacyConfig, baseRef: binding.baseSha };
  const capture =
    ports.capture ??
    (async (root, config, mode) =>
      projectCapturedValidationPlan(
        await captureCanonicalValidationPlan(root, config, mode),
      ));
  const selection =
    input.mode === "full-health"
      ? await capture(input.candidateRoot, legacy, input.mode)
      : comparison;
  if (
    selection.plan.mode !== input.mode ||
    !selection.plan.checks.length ||
    selection.candidate.mode !== "clean" ||
    selection.candidate.headSha !== binding.headSha ||
    selection.candidate.base.tipSha !== binding.baseSha ||
    selection.candidate.treeSha !== comparison.candidate.treeSha
  )
    throw new Error(
      "Recomputed final selection does not match authenticated candidate",
    );

  // These are hints only. They become usable health/invocation bindings solely
  // after native verification and exact selected-attempt checks below succeed.
  const { record, bytes } = await readRecord(input.candidateRoot);
  const revisions = new Set(
    retainedFlags(record, GUARD_PROVIDER).map(
      (flags) => flags[HEALTH_REVISION],
    ),
  );
  const plannedHealthRevision = [...revisions][0];
  if (
    revisions.size !== 1 ||
    typeof plannedHealthRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(plannedHealthRevision)
  )
    throw new Error(
      "Native planned health revision hint is missing or ambiguous",
    );
  const env: NodeJS.ProcessEnv = {
    ...input.env,
    [HEALTH_REVISION]: plannedHealthRevision,
  };
  const projected = (ports.configure ?? configureScopedValidation)(
    input.candidateRoot,
    legacy,
    input.mode,
    env,
    () => selection,
  );
  const config = createCiValidationConfiguration(
    projected.config,
    input.mode === "full-health",
  );
  const mapping = Object.fromEntries<string>([
    ["__selection_guard", GUARD_PROVIDER] as const,
    ...projected.checks.map(
      (check) => [check.checkId, check.providerId] as const,
    ),
  ]);
  if (
    projected.checks.length !== selection.plan.checks.length ||
    new Set(projected.checks.map((row) => row.checkId)).size !==
      projected.checks.length ||
    selection.plan.checks.some((check) => !mapping[check.id]) ||
    new Set(Object.values(mapping)).size !== Object.keys(mapping).length
  )
    throw new Error("Incomplete recomputed check mapping");
  const invocationPrefix = `${binding.repository}:${binding.runId}:${binding.runAttempt}:full-health:`;
  let invocation: string | undefined;
  if (input.mode === "full-health") {
    const values = new Set(
      Object.values(mapping).flatMap((providerId) =>
        retainedFlags(record, providerId).map((flags) => flags[INVOCATION]),
      ),
    );
    const value = [...values][0];
    if (
      values.size !== 1 ||
      typeof value !== "string" ||
      !value.startsWith(invocationPrefix) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        value.slice(invocationPrefix.length),
      )
    )
      throw new Error(
        "Full-health invocation does not match authenticated repository/run/attempt/mode",
      );
    invocation = value;
    env[INVOCATION] = invocation;
  }
  await assertCold(input.candidateRoot, config);
  const nativeCapture = await (
    await wireRepo(input.candidateRoot, config)
  ).captureCandidate();
  if (
    !nativeCapture.ok ||
    nativeCapture.candidate.mode !== "clean" ||
    nativeCapture.candidate.headSha !== binding.headSha ||
    nativeCapture.candidate.treeSha !== selection.candidate.treeSha ||
    nativeCapture.candidate.base.tipSha !== binding.baseSha
  )
    throw new Error("Native record candidate moved");
  const nativeRecordRef = path.join(
    input.candidateRoot,
    deliveryRecordPathFor(config, nativeCapture.candidate.deliverable.digest),
  );
  if (
    path.dirname(nativeRecordRef) !==
    path.join(input.candidateRoot, "artifacts/validation-ci")
  )
    throw new Error("Unexpected trusted record path");
  await writeFile(nativeRecordRef, bytes, { flag: "wx" });
  const native = await (ports.verify ?? verifyNativeValidation)({
    rootDir: input.candidateRoot,
    config,
    env,
    binding,
    checkIdToProviderId: mapping,
  });
  if (
    native.status !== "verified" ||
    native.phases.length !== 1 ||
    native.phases[0].phase !== "verify" ||
    native.phases[0].exitCode !== 0
  )
    throw new Error(
      `Cold native verification refused the portable record: ${native.status === "failed" ? (native.error ?? `exit ${native.exitCode}`) : "unexpected phases"}`,
    );
  if (
    native.recordRef !== nativeRecordRef ||
    [native.beforeObservations, native.observations].some((rows) =>
      rows.providers.some((provider) => provider.attempts.length),
    )
  )
    throw new Error(
      "Cold verification used unexpected record or local attempt store",
    );
  await assertCold(input.candidateRoot, config);
  if (
    native.selectedAttempts.length !== Object.keys(mapping).length ||
    new Set(native.selectedAttempts.map((row) => row.checkId)).size !==
      native.selectedAttempts.length
  )
    throw new Error("Incomplete native selected attempts");
  for (const selected of native.selectedAttempts) {
    if (
      mapping[selected.checkId] !== selected.providerId ||
      selected.attempt.status !== "passed"
    )
      throw new Error("Native selected attempt did not pass");
    if (
      input.mode === "full-health" &&
      (selected.observation.flags[INVOCATION] !== invocation ||
        selected.attempt.origin.candidate.treeSha !==
          selection.candidate.treeSha ||
        selected.attempt.origin.candidate.baseTipSha !== binding.baseSha)
    )
      throw new Error(
        "Verified full-health attempt belongs to another invocation/candidate",
      );
    const rawResults = evidence(native.record, selected.providerId);
    if (
      !rawResults.length ||
      rawResults.some((artifacts) => {
        const raw = JSON.parse(artifacts.get("check-result.json") ?? "null");
        return (
          !raw ||
          raw.providerId !== selected.providerId ||
          raw.runId !== selected.attempt.attemptId ||
          raw.exitCode !== 0 ||
          raw.verdict !== "green" ||
          raw.attributed === true ||
          raw.attribution !== undefined ||
          (raw.originalExitCode !== undefined && raw.originalExitCode !== 0)
        );
      })
    )
      throw new Error(
        "Native raw failed or attributed result cannot project success",
      );
  }
  const selectedGuard = native.selectedAttempts.find(
    (row) => row.checkId === "__selection_guard",
  );
  if (
    selectedGuard?.observation.flags[HEALTH_REVISION] !== plannedHealthRevision
  )
    throw new Error("Verified guard health revision differs from record hint");
  const finalGuard = await guard();
  const finalSelection = requireGuard(finalGuard);
  if (
    JSON.stringify(finalGuard.binding) !== JSON.stringify(binding) ||
    finalSelection.plan.digest !== comparison.plan.digest ||
    finalSelection.candidate.treeSha !== selection.candidate.treeSha
  )
    throw new Error(
      "Authenticated final binding or selection moved during verification",
    );
  const verified: VerifiedHostedValidation = {
    ...binding,
    planDigest: selection.plan.digest,
    recordRef: native.recordRef,
    checks: selection.plan.checks.map((check) => ({
      ...binding,
      checkId: check.id,
      identity: check.identity,
      profile: check.profile,
      outcome: "success",
      originalExitCode: 0,
      attributed: false,
      execution: input.mode === "full-health" ? "executed" : "reused",
    })),
  };
  return {
    plan: selection.plan,
    candidate: selection.candidate,
    selectedAttempts: native.selectedAttempts,
    verified,
    native,
    plannedHealthRevision,
  };
}

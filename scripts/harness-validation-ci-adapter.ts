import { readScopedCheckDiagnostics } from "../.agent-skills/current/runtime/cli-api.mjs";
import {
  collectValidationDiagnostics,
  type ReadDiagnostics,
} from "./harness-validation-ci-diagnostics";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { realpath, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { loadHarnessBaseConfig } from "./harness-base-config-loader";
import {
  runGitCommand,
  digestCanonical,
  type HarnessConfig,
} from "../.agent-skills/current/runtime/kernel.mjs";
import {
  captureCanonicalValidationPlan,
  projectCapturedValidationPlan,
} from "./harness-validation-capture";
import { configureScopedValidation } from "./harness-validation-runtime";
import { guardValidationCandidate } from "./harness-validation-trust";
import {
  resolveHostedValidationBinding,
  type HostedValidationBinding,
} from "./harness-validation-ci-binding";
import {
  evaluateValidationHealth,
  type HealthSnapshot,
  type RepairProof,
} from "./harness-validation-health";
import {
  createCiValidationConfiguration,
  healthCandidateScopes,
  validationCheckHealthScope,
} from "./harness-validation-ci-policy";
import {
  runNativeValidation,
  verifyNativeValidation,
} from "./harness-validation-native";
import type {
  ValidationCiRuntime,
  VerifiedHostedValidation,
  HealthObservation,
} from "./harness-validation-ci";
import type { NativeValidationSelection } from "./harness-validation-load";
import type { ValidationPlan } from "./harness-validation-plan";

type NativeInput = Parameters<typeof runNativeValidation>[0];
type NativeResult = Awaited<ReturnType<typeof runNativeValidation>>;
const sameBinding = (a: HostedValidationBinding, b: HostedValidationBinding) =>
  (["repository", "runId", "runAttempt", "headSha", "baseSha"] as const).every(
    (key) => a[key] === b[key],
  );

/** Controller-owned dependency ports; never populated from uploaded data. */
export type ValidationCiAdapterPorts = {
  env?: NodeJS.ProcessEnv;
  controllerRoot?: string;
  authenticate?: typeof resolveHostedValidationBinding;
  loadLegacy?: typeof loadHarnessBaseConfig;
  captureSelection?: (
    root: string,
    config: HarnessConfig,
    mode: "comparison" | "full-health",
  ) => Promise<NativeValidationSelection>;
  guard?: typeof guardValidationCandidate;
  configure?: typeof configureScopedValidation;
  executeNative?: typeof runNativeValidation;
  verifyNative?: typeof verifyNativeValidation;
  readDiagnostics?: ReadDiagnostics;
};

/** Hosted adapter uses the module's trusted controller checkout for policy and
 * the explicitly captured candidate only as data. No uploaded plan is authority. */
export async function createValidationCiRuntime(
  rootDir: string,
  ports: ValidationCiAdapterPorts = {},
): Promise<ValidationCiRuntime> {
  const env = { ...(ports.env ?? process.env) };
  if (env.ATHENA_VALIDATION_MODE !== undefined)
    throw new Error(
      "Hosted controller owns validation mode; remove the local opt-in flag",
    );
  const baseRoot =
    ports.controllerRoot ?? path.resolve(import.meta.dirname, "..");
  const command = env.VALIDATION_GUARD_BASE_SHA ? "qualify" : "health";
  let legacy: HarnessConfig | undefined;
  let inventory: NativeValidationSelection | undefined;
  let selection: NativeValidationSelection | undefined;
  let nativeInput: NativeInput | undefined;
  let result: NativeResult | undefined;
  let verified: VerifiedHostedValidation | undefined;
  let executionHealth: HealthSnapshot | undefined;
  let execution:
    | {
        planKey: string;
        candidateRef: string;
        binding: HostedValidationBinding;
      }
    | undefined;

  const assertRoot = async (root: string, sha: string) => {
    if ((await realpath(root)) !== path.resolve(root))
      throw new Error("Hosted source root aliases are forbidden");
    for (const [args, expected] of [
      [["rev-parse", "--show-toplevel"], root],
      [["rev-parse", "HEAD"], sha],
      [["status", "--porcelain=v1", "--untracked-files=all"], ""],
    ] as const) {
      const read = await runGitCommand(
        ["git", "--no-replace-objects", "-c", "core.fsmonitor=false", ...args],
        { cwd: root },
      );
      if (read.exitCode !== 0 || read.stdout.trim() !== expected)
        throw new Error(
          "Hosted source no longer matches its clean pinned commit",
        );
    }
  };
  const freshBinding = async (binding: HostedValidationBinding) => {
    const actual = await (ports.authenticate ?? resolveHostedValidationBinding)(
      command,
      env,
    );
    if (
      !sameBinding(actual, binding) ||
      (inventory && inventory.candidate.headSha !== actual.defaultMainSha)
    )
      throw new Error("Hosted validation binding moved");
    await assertRoot(rootDir, binding.headSha);
    await assertRoot(baseRoot, binding.baseSha);
  };
  const capture = async (
    root: string,
    sha: string,
    mode: "comparison" | "full-health",
  ) => {
    if (!legacy)
      throw new Error("Protected health inventory must be loaded first");
    if (ports.captureSelection)
      return ports.captureSelection(root, { ...legacy, baseRef: sha }, mode);
    return projectCapturedValidationPlan(
      await captureCanonicalValidationPlan(
        root,
        { ...legacy, baseRef: sha },
        mode,
      ),
    );
  };
  const requirePlan = (plan: ValidationPlan) => {
    if (!selection || digestCanonical(selection.plan) !== digestCanonical(plan))
      throw new Error("Native plan changed before execution or verification");
    return selection;
  };
  const requireExecution = (
    plan: ValidationPlan,
    binding: HostedValidationBinding,
  ) => {
    const current = requirePlan(plan);
    if (
      !execution ||
      execution.planKey !== digestCanonical(plan) ||
      execution.candidateRef !== current.candidate.treeSha ||
      !sameBinding(execution.binding, binding)
    )
      throw new Error(
        "Native execution does not match the current plan and binding",
      );
  };
  const failureRows = (
    plan: ValidationPlan,
    binding: HostedValidationBinding,
  ): HealthObservation[] => {
    const before = new Set(
      result?.beforeObservations.providers.flatMap((provider) =>
        provider.attempts.map((attempt) => attempt.attemptId),
      ) ?? [],
    );
    return plan.checks.map((check) => {
      const providerId = nativeInput?.checkIdToProviderId[check.id];
      const attempts =
        result?.observations.providers.find(
          (provider) => provider.providerId === providerId,
        )?.attempts ?? [];
      const attempt = [...attempts]
        .filter(
          (attempt) =>
            !before.has(attempt.attemptId) &&
            attempt.providerId === providerId &&
            attempt.origin.candidate.treeSha === selection?.candidate.treeSha &&
            attempt.origin.candidate.baseTipSha === binding.baseSha &&
            attempt.origin.candidate.identityToken ===
              nativeInput?.config.computingIdentityVersion,
        )
        .sort((a, b) => b.generation - a.generation)[0];
      return {
        ...binding,
        checkId: check.id,
        outcome:
          attempt?.status === "passed"
            ? "success"
            : attempt?.status === "failed"
              ? "failure"
              : attempt?.status === "interrupted"
                ? "cancelled"
                : "unavailable",
        originalExitCode: attempt?.status === "passed" ? 0 : null,
        attributed: false,
        execution: "executed",
      };
    });
  };

  return {
    async healthInventory(defaultMainSha) {
      await assertRoot(baseRoot, defaultMainSha);
      legacy = await (ports.loadLegacy ?? loadHarnessBaseConfig)(baseRoot);
      if (legacy.scopedExecution)
        throw new Error(
          "Trusted controller must supply the legacy policy explicitly",
        );
      inventory = await capture(baseRoot, defaultMainSha, "full-health");
      return structuredClone(inventory.plan);
    },
    async recomputePlan(binding, mode, health) {
      await freshBinding(binding);
      if (!legacy || !inventory)
        throw new Error("Protected health inventory missing");
      if (command === "qualify") {
        const guarded = await (ports.guard ?? guardValidationCandidate)(
          baseRoot,
          rootDir,
          env,
          {
            legacyConfig: legacy,
          },
        );
        if (guarded.readiness !== "scoped" || !guarded.selection)
          throw new Error(
            "Trusted base requires legacy validation for this candidate",
          );
        selection = structuredClone(guarded.selection);
      } else {
        if (binding.headSha !== binding.baseSha)
          throw new Error(
            "Full health requires the current protected main commit",
          );
        selection = structuredClone(inventory);
      }
      const decision =
        health &&
        evaluateValidationHealth({
          health,
          candidate: {
            candidateRef: selection.candidate.treeSha,
            profile: "hosted",
            scopes: healthCandidateScopes(selection.plan.changes),
          },
        });
      if (
        mode === "full-health" ||
        !decision ||
        decision.status !== "eligible"
      ) {
        if (selection.plan.mode !== "full-health")
          selection = await capture(rootDir, binding.baseSha, "full-health");
      }
      return structuredClone(selection.plan);
    },
    async execute(plan, binding, context) {
      nativeInput = undefined;
      result = undefined;
      verified = undefined;
      executionHealth = undefined;
      execution = undefined;
      const current = requirePlan(plan);
      await freshBinding(binding);
      if (!legacy) throw new Error("Protected policy missing");
      const invocationPrefix = `${binding.repository}:${binding.runId}:${binding.runAttempt}:${plan.mode}`;
      if (context.invocationId !== invocationPrefix)
        throw new Error(
          "Validation invocation does not match authenticated run",
        );
      const executionEnv = {
        ...env,
        ATHENA_VALIDATION_INVOCATION: `${invocationPrefix}:${randomUUID()}`,
        ATHENA_VALIDATION_HEALTH_REVISION: context.health.revision,
      };
      const projected = (ports.configure ?? configureScopedValidation)(
        rootDir,
        { ...legacy, baseRef: binding.baseSha },
        plan.mode,
        executionEnv,
        () => current,
      );
      nativeInput = {
        rootDir,
        config: createCiValidationConfiguration(
          projected.config,
          plan.mode === "full-health",
        ),
        env: executionEnv,
        binding,
        checkIdToProviderId: Object.fromEntries([
          ["__selection_guard", "athena.selection-guard"],
          ...projected.checks.map((check) => [check.checkId, check.providerId]),
        ]),
      };
      executionHealth = structuredClone(context.health);
      execution = {
        planKey: digestCanonical(plan),
        candidateRef: current.candidate.treeSha,
        binding: { ...binding },
      };
      verified = undefined;
      result = await (ports.executeNative ?? runNativeValidation)(nativeInput);
      if (result.status !== "verified")
        throw new Error(`Native validation failed during ${result.phase}`);
    },
    async verifyExecution(plan, binding) {
      verified = undefined;
      requireExecution(plan, binding);
      await freshBinding(binding);
      if (!nativeInput || !result || result.status !== "verified")
        throw new Error("Native execution has no verified complete result");
      const current = await (ports.verifyNative ?? verifyNativeValidation)(
        nativeInput,
      );
      if (current.status !== "verified")
        throw new Error("Fresh native verification refused the record");
      const before = new Set(
        result.beforeObservations.providers.flatMap((provider) =>
          provider.attempts.map((attempt) => attempt.attemptId),
        ),
      );
      const guard = current.selectedAttempts.find(
        (row) =>
          row.checkId === "__selection_guard" &&
          row.providerId === "athena.selection-guard",
      );
      if (
        !guard ||
        guard.attempt.status !== "passed" ||
        !executionHealth ||
        guard.observation.flags.ATHENA_VALIDATION_HEALTH_REVISION !==
          executionHealth.revision
      )
        throw new Error(
          "Native selection guard does not bind the executed health revision",
        );
      if (
        plan.mode === "full-health" &&
        (before.has(guard.attempt.attemptId) ||
          guard.observation.flags.ATHENA_VALIDATION_INVOCATION !==
            nativeInput.env.ATHENA_VALIDATION_INVOCATION)
      )
        throw new Error(
          "Full health attempted to reuse another guard invocation",
        );
      const checks = plan.checks.map((check) => {
        const selected = current.selectedAttempts.find(
          (attempt) => attempt.checkId === check.id,
        );
        if (!selected || selected.attempt.status !== "passed")
          throw new Error(`Missing native selected attempt: ${check.id}`);
        if (
          plan.mode === "full-health" &&
          (selected.observation.flags.ATHENA_VALIDATION_INVOCATION !==
            nativeInput!.env.ATHENA_VALIDATION_INVOCATION ||
            before.has(selected.attempt.attemptId))
        )
          throw new Error("Full health attempted to reuse another invocation");
        return {
          ...binding,
          checkId: check.id,
          identity: check.identity,
          profile: check.profile,
          outcome: "success" as const,
          originalExitCode: 0,
          attributed: false,
          execution: before.has(selected.attempt.attemptId)
            ? ("reused" as const)
            : ("executed" as const),
        };
      });
      // Normalize transport from the exact product-verified value, never by
      // rereading an unchecked path after native verification has returned.
      const transportDir = path.join(rootDir, "artifacts/validation-ci");
      await mkdir(transportDir, { recursive: true });
      if ((await realpath(transportDir)) !== transportDir)
        throw new Error("Native transport directory aliases are forbidden");
      const temporary = path.join(
        transportDir,
        `transport-${randomUUID()}.json`,
      );
      try {
        await writeFile(temporary, JSON.stringify(current.record) + "\n", {
          flag: "wx",
        });
        await rename(
          temporary,
          path.join(transportDir, "delivery-record.json"),
        );
      } finally {
        await rm(temporary, { force: true });
      }
      verified = {
        ...binding,
        planDigest: plan.digest,
        recordRef: current.recordRef,
        checks,
      };
      return structuredClone(verified);
    },
    async readDiagnostics(plan, binding) {
      const current = requirePlan(plan);
      requireExecution(plan, binding);
      return collectValidationDiagnostics({
        rootDir,
        plan,
        binding,
        selection: current,
        nativeInput,
        result,
        read: ports.readDiagnostics ?? readScopedCheckDiagnostics,
      });
    },
    async readFailureObservations(plan, binding) {
      requirePlan(plan);
      await freshBinding(binding);
      if (execution) requireExecution(plan, binding);
      return verified?.planDigest === plan.digest
        ? structuredClone(verified.checks)
        : failureRows(plan, binding);
    },
    async verifyHealthAdmission(plan, binding, health) {
      requireExecution(plan, binding);
      const current = requirePlan(plan);
      await freshBinding(binding);
      if (
        !verified ||
        !executionHealth ||
        executionHealth.revision !== health.planned.revision
      )
        throw new Error(
          "Health admission lacks native execution for its planned revision",
        );
      const proofs: RepairProof[] = health.current.findings.flatMap(
        (finding) => {
          const check = plan.checks.find(
            (check) => check.id === finding.checkId,
          );
          if (
            !check ||
            !verified!.checks.some(
              (row) => row.checkId === check.id && row.outcome === "success",
            )
          )
            return [];
          return [
            {
              candidateRef: current.candidate.treeSha,
              profile: "hosted",
              healthRevision: health.planned.revision,
              findingId: finding.id,
              findingRevision: finding.revision,
              checkId: check.id,
              scope: validationCheckHealthScope(check.profile),
              outcome: "success",
              evidenceRef: verified!.recordRef,
            },
          ];
        },
      );
      const decision = evaluateValidationHealth({
        health: health.current,
        candidate: {
          candidateRef: current.candidate.treeSha,
          profile: "hosted",
          scopes: healthCandidateScopes(plan.changes),
        },
        proofs,
        plannedHealthRevision: health.planned.revision,
        ...(plan.mode === "full-health"
          ? {
              fullValidation: {
                candidateRef: current.candidate.treeSha,
                profile: "hosted" as const,
                healthRevision: health.planned.revision,
                outcome: "success" as const,
                evidenceRef: verified.recordRef,
                mode: "full-health" as const,
              },
            }
          : {}),
      });
      if (decision.status !== "eligible")
        throw new Error(
          `Validation health refused admission: ${decision.reason}`,
        );
    },
  };
}

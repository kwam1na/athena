import {
  diagnosticsDirectory,
  unavailableDiagnostics,
  writeValidationDiagnostics,
  type ValidationDiagnostics,
} from "./harness-validation-ci-diagnostics";
import { loadHarnessBaseConfig } from "./harness-base-config-loader";
import {
  createHealthIncidentReport,
  renderHealthIncidentReport,
} from "./harness-validation-health-incidents";
import { validationCheckHealthScope } from "./harness-validation-ci-policy";
import {
  resolveHostedValidationBinding,
  requestCiJson,
  jsonRecord,
  HEALTH_WORKFLOW_PATH,
  type JsonRequest,
  type HostedValidationBinding,
  type HealthRunIdentity,
} from "./harness-validation-ci-binding";
export {
  resolveHostedValidationBinding,
  HEALTH_WORKFLOW_PATH,
} from "./harness-validation-ci-binding";
export type {
  HostedValidationBinding,
  HealthRunIdentity,
} from "./harness-validation-ci-binding";
import { createHash } from "node:crypto";
import {
  HEALTH_HISTORY_CHECK_ID,
  readValidationHealth,
  createHealthApprovalVerifier,
} from "./harness-validation-health";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HarnessBlockedError,
  createHarnessBlocker,
  runHarnessCliBoundary,
} from "./harness-blockers";
import type { ValidationPlan } from "./harness-validation-plan";
import type {
  HealthDigest,
  HealthPolicy,
  HealthSnapshot,
} from "./harness-validation-health";

/** Trusted adapter output only: authenticate hosted provenance and inspect native
 * original execution/attribution before calling the producer. An uploaded JSON
 * result or a product's attributed green verdict is not this capability. */
export type HealthObservation = HealthRunIdentity & {
  checkId: string;
  outcome: "success" | "failure" | "cancelled" | "unavailable";
  originalExitCode: number | null;
  attributed: boolean;
  execution: "executed" | "reused";
};

export const REQUIRED_VALIDATION_CONTEXTS = [
  "Athena and Storefront Webapp Validation",
  "Storefront Webapp Validation Context",
  "Harness Implementation Tests",
  "Harness and Architecture Validation",
  "Athena POS E2E against Production Backend",
] as const;

import {
  HEALTH_ARTIFACT_NAME,
  HEALTH_CLASSIFICATION_PATH,
} from "./harness-validation-local-authority.ts";
export {
  HEALTH_ARTIFACT_NAME,
  HEALTH_CLASSIFICATION_PATH,
} from "./harness-validation-local-authority.ts";

export function parseValidationCiArgs(args: string[]) {
  const command = args[0];
  if (
    !["health", "qualify"].includes(command) ||
    new Set(args).size !== args.length ||
    args
      .slice(1)
      .some(
        (arg) =>
          command !== "health" ||
          !["--bootstrap", "--recover-unknown-history"].includes(arg),
      )
  ) {
    throw new Error(
      "Usage: harness:validation-ci qualify | health [--bootstrap] [--recover-unknown-history]",
    );
  }
  return {
    command: command as "health" | "qualify",
    bootstrap: args.includes("--bootstrap"),
    recoverUnknownHistory: args.includes("--recover-unknown-history"),
  };
}

/** In-memory output of the native verifier and authenticated hosted readout.
 * This is not a serialized receipt or an alternative verification protocol. */
export type VerifiedHostedValidation = HostedValidationBinding & {
  planDigest: string;
  recordRef: string;
  checks: Array<HealthObservation & { identity: string; profile: string }>;
};

/** U6 owns the implementation in harness-validation-runtime.ts. These are native
 * capabilities, not parsers for uploaded plans, synthetic receipts or log text. */
export type ValidationCiRuntime = {
  readDiagnostics?(
    plan: ValidationPlan,
    binding: HostedValidationBinding,
  ): Promise<ValidationDiagnostics>;
  recomputePlan(
    binding: HostedValidationBinding,
    mode: "comparison" | "full-health",
    health?: HealthSnapshot,
  ): Promise<ValidationPlan>;
  healthInventory(defaultMainSha: string): Promise<ValidationPlan>;
  execute(
    plan: ValidationPlan,
    binding: HostedValidationBinding,
    context: { invocationId: string; health: HealthSnapshot },
  ): Promise<void>;
  verifyExecution(
    plan: ValidationPlan,
    binding: HostedValidationBinding,
  ): Promise<VerifiedHostedValidation>;
  readFailureObservations(
    plan: ValidationPlan,
    binding: HostedValidationBinding,
  ): Promise<HealthObservation[]>;
  verifyHealthAdmission(
    plan: ValidationPlan,
    binding: HostedValidationBinding,
    health: { planned: HealthSnapshot; current: HealthSnapshot },
  ): Promise<void>;
};

export type FinalValidationVerifier = (input: {
  baseRoot: string;
  candidateRoot: string;
  env: NodeJS.ProcessEnv;
  mode: "comparison" | "full-health";
}) => Promise<{
  plan: ValidationPlan;
  candidate: { treeSha: string };
  verified: VerifiedHostedValidation;
  plannedHealthRevision: string;
}>;

export async function runValidationCiCli(
  args: string[],
  options: {
    rootDir?: string;
    env?: NodeJS.ProcessEnv;
    runtime?: ValidationCiRuntime;
    requestJson?: JsonRequest;
    readHealth?: typeof readValidationHealth;
    finalVerifier?: FinalValidationVerifier;
    verifyDeliveryTelemetry?: (
      candidateRoot: string,
      baseRoot: string,
      baseSha: string,
    ) => Promise<void>;
  } = {},
) {
  if (args[0] === "verify-final") {
    const env = options.env ?? process.env;
    const mode = env.VALIDATION_PLAN_MODE;
    if (args.length !== 1 || (mode !== "comparison" && mode !== "full-health"))
      throw new Error(
        "verify-final requires the trusted controller's explicit plan mode",
      );
    if (env.VALIDATION_EXECUTION_RESULT !== "success")
      throw new Error(
        "Final verification requires successful native execution job",
      );
    if (!env.GITHUB_OUTPUT) throw new Error("Hosted final output is required");
    const rootDir = options.rootDir ?? process.cwd();
    const baseRoot = path.resolve(import.meta.dirname, "..");
    const requestJson = options.requestJson ?? requestCiJson;
    const binding = await resolveHostedValidationBinding(
      "qualify",
      env,
      requestJson,
    );
    const runtime = options.runtime ?? (await loadCiRuntime(rootDir));
    const policy = await resolveValidationHealthPolicy(
      binding,
      await runtime.healthInventory(binding.defaultMainSha),
      requestJson,
    );
    const readHealth = options.readHealth ?? readValidationHealth;
    const readOptions = {
      requestJson,
      verifyClassificationApproval: createHealthApprovalVerifier(
        policy,
        requestJson,
      ),
    };
    const initialHealth = await readHealth(policy, readOptions);
    const finalVerifier =
      options.finalVerifier ??
      (async (input) => {
        const modulePath = path.join(
          import.meta.dirname,
          "harness-validation-ci-final.ts",
        );
        const module = await import(modulePath);
        if (typeof module.verifyFinalHostedValidation !== "function")
          throw new Error("Trusted final verifier unavailable");
        return module.verifyFinalHostedValidation({
          ...input,
          legacyConfig: await loadHarnessBaseConfig(baseRoot),
        });
      });
    const final = await finalVerifier({
      baseRoot,
      candidateRoot: rootDir,
      env,
      mode,
    });
    if (final.plan.mode !== mode) throw new Error("Final plan mode changed");
    const health = await readHealth(policy, {
      ...readOptions,
      previous: initialHealth,
    });
    const { admitFinalValidationHealth } =
      await import("./harness-validation-ci-admission");
    admitFinalValidationHealth({
      plan: final.plan,
      verified: final.verified,
      candidateRef: final.candidate.treeSha,
      plannedHealthRevision: final.plannedHealthRevision,
      health,
    });
    // Scoped snapshots validate artifact bytes. Current delivery completion is
    // a separate host obligation over the authenticated original candidate.
    const verifyDeliveryTelemetry =
      options.verifyDeliveryTelemetry ??
      (async (candidateRoot, trustedRoot, baseSha) => {
        const { assertDeliveryRunTelemetryCheck } =
          await import("./delivery-run-telemetry");
        const config = await loadHarnessBaseConfig(trustedRoot);
        await assertDeliveryRunTelemetryCheck(candidateRoot, {
          baseRef: baseSha,
          ciMode: true,
          config: { ...config, baseRef: baseSha },
        });
      });
    await verifyDeliveryTelemetry(rootDir, baseRoot, binding.baseSha);
    const summary = await summarizeHostedValidation({
      binding,
      executionJobResult: env.VALIDATION_EXECUTION_RESULT,
      recomputePlan: async () => final.plan,
      verifyExecution: async () => final.verified,
    });
    if (
      Object.values(summary.contexts).some(
        (row) => row.conclusion !== "success",
      )
    )
      throw new Error("Final native summary refused");
    await mkdir(path.join(rootDir, "artifacts/validation-ci"), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDir, "artifacts/validation-ci/final-summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
    await appendFile(env.GITHUB_OUTPUT, "verified=true\n");
    return;
  }
  if (args[0] === "guard") {
    const env = options.env ?? process.env;
    if (!env.GITHUB_OUTPUT) throw new Error("Hosted guard output is required");
    const baseRoot = path.resolve(import.meta.dirname, "..");
    const { runValidationGuardCli } =
      await import("./harness-validation-trust");
    await runValidationGuardCli(args, {
      baseRoot,
      env,
      legacyConfig: await loadHarnessBaseConfig(baseRoot),
      requestJson: options.requestJson,
      writeOutput: (text) => appendFile(env.GITHUB_OUTPUT!, text),
    });
    return;
  }
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(
      "Usage: harness:validation-ci qualify | health [--bootstrap] [--recover-unknown-history]\n       harness:validation-ci guard --candidate-root <absolute-path>\n       harness:validation-ci verify-final\nverify-final requires trusted VALIDATION_PLAN_MODE and successful VALIDATION_EXECUTION_RESULT job outputs.\nHosted only: authenticates GitHub run/base/head, invokes the qualified native adapter and retains summary or health.json. Health requires a new default-branch run, never a GitHub rerun. Supports authenticated PRs and explicit dispatch; workflow routing selects when affected validation runs.",
    );
    return;
  }
  const request = parseValidationCiArgs(args);
  const rootDir = options.rootDir ?? process.cwd();
  const env = options.env ?? process.env;
  const outputDir = path.join(rootDir, "artifacts/validation-ci");
  if (request.command === "health") {
    await diagnosticsDirectory(rootDir);
    await rm(path.join(outputDir, "diagnostics.json"), { force: true });
  }
  await mkdir(outputDir, { recursive: true });
  const outputFile = path.join(
    outputDir,
    request.command === "health" ? "health.json" : "summary.json",
  );
  await rm(outputFile, { force: true });
  if (request.command === "health") {
    for (const name of ["health-incidents.json", "health-incidents.md"])
      await rm(path.join(outputDir, name), { force: true });
  }
  const requestJson = options.requestJson ?? requestCiJson;
  const binding = await resolveHostedValidationBinding(
    request.command,
    env,
    requestJson,
  );
  const runtime = options.runtime ?? (await loadCiRuntime(rootDir));
  const mode = request.command === "health" ? "full-health" : "comparison";
  const inventory = await runtime.healthInventory(binding.defaultMainSha);
  const policy = await resolveValidationHealthPolicy(
    binding,
    inventory,
    requestJson,
  );
  if (request.command === "health" && policy.workflowId !== binding.workflowId)
    throw new Error("Producer workflow identity changed");
  const readHealth = options.readHealth ?? readValidationHealth;
  const readOptions = {
    requestJson,
    verifyClassificationApproval: createHealthApprovalVerifier(
      policy,
      requestJson,
    ),
    ...(request.command === "health"
      ? { excludeCurrentRunId: binding.runId }
      : {}),
  };
  const planned = await readHealth(policy, readOptions);
  const recomputePlan = async (bound: HostedValidationBinding) => {
    // Health may require a full inventory before execution. Recompute with the
    // same planning snapshot at admission; current health is checked separately.
    const result = await runtime.recomputePlan(bound, mode, planned);
    if (
      result.mode !== mode &&
      !(request.command === "qualify" && result.mode === "full-health")
    )
      throw new Error("Native plan mode does not match hosted request");
    return result;
  };
  const plan = await recomputePlan(binding);
  let executionFailed = false;
  try {
    await runtime.execute(plan, binding, {
      invocationId: `${binding.repository}:${binding.runId}:${binding.runAttempt}:${plan.mode}`,
      health: planned,
    });
  } catch {
    executionFailed = true;
  }
  if (request.command === "health") {
    let diagnostics = unavailableDiagnostics(
      plan,
      binding,
      "runtime-unavailable",
    );
    try {
      if (runtime.readDiagnostics)
        diagnostics = await runtime.readDiagnostics(plan, binding);
    } catch {
      diagnostics = unavailableDiagnostics(
        plan,
        binding,
        "diagnostic-read-unavailable",
      );
    }
    // Retain before later health reads/admission can fail; never substitute for health.
    try {
      await writeValidationDiagnostics(rootDir, diagnostics);
    } catch {
      console.error(
        "Validation diagnostics could not be retained; health authority is unchanged.",
      );
    }
  }
  const current = await readHealth(policy, {
    ...readOptions,
    previous: planned,
  });
  if (request.command === "qualify") {
    const summary = await summarizeHostedValidation({
      binding,
      executionJobResult: executionFailed ? "failure" : "success",
      recomputePlan,
      verifyExecution: async (p, b) => {
        const verified = await runtime.verifyExecution(p, b);
        await runtime.verifyHealthAdmission(p, b, { planned, current });
        return verified;
      },
    });
    await writeFile(outputFile, JSON.stringify(summary, null, 2) + "\n");
    if (Object.values(summary.contexts).some((c) => c.conclusion !== "success"))
      throw new Error(
        "Hosted validation summary refused; inspect artifacts/validation-ci/summary.json",
      );
    if (env.GITHUB_OUTPUT)
      await appendFile(
        env.GITHUB_OUTPUT,
        `verified=true\nplan_mode=${plan.mode}\ncontexts=${JSON.stringify(summary.contexts)}\n`,
      );
    return;
  }
  const digest = await createVerifiedValidationHealthDigest({
    policy,
    run: binding,
    previous: current,
    bootstrap: request.bootstrap,
    recoverUnknownHistory: request.recoverUnknownHistory,
    verifyFullInventory: async () => {
      const observations = await runtime.readFailureObservations(plan, binding);
      // Failed or interrupted execution has no successful record. Authenticated
      // failure observations still publish; green publication needs native proof.
      const appearsSuccessful =
        observations.length === policy.checks.length &&
        observations.every(
          (o) =>
            o.outcome === "success" &&
            o.originalExitCode === 0 &&
            o.attributed === false &&
            o.execution === "executed",
        );
      if (appearsSuccessful) {
        const summary = await summarizeHostedValidation({
          binding,
          executionJobResult: executionFailed ? "failure" : "success",
          recomputePlan,
          verifyExecution: (p, b) => runtime.verifyExecution(p, b),
        });
        if (
          Object.values(summary.contexts).some(
            (c) => c.conclusion !== "success",
          )
        )
          throw new Error("Native full-inventory success verification refused");
        await runtime.verifyHealthAdmission(plan, binding, {
          planned,
          current,
        });
      }
      return observations;
    },
  });
  await writeFile(outputFile, JSON.stringify(digest, null, 2) + "\n");
  const incidents = createHealthIncidentReport(digest, policy, current);
  await writeFile(
    path.join(outputDir, "health-incidents.json"),
    JSON.stringify(incidents, null, 2) + "\n",
  );
  await writeFile(
    path.join(outputDir, "health-incidents.md"),
    renderHealthIncidentReport(incidents),
  );
  if (!digest.complete || digest.checks.some((c) => c.outcome !== "success"))
    throw new Error(
      "Full-health observed failures or incomplete checks; health.json retained",
    );
}

/** Protected inventory and authenticated workflow metadata define health scope. */
export async function resolveValidationHealthPolicy(
  binding: Awaited<ReturnType<typeof resolveHostedValidationBinding>>,
  inventory: ValidationPlan,
  requestJson: JsonRequest,
): Promise<HealthPolicy> {
  if (inventory.mode !== "full-health" || !inventory.checks.length)
    throw new Error("Protected main full-health inventory required");
  const workflow = await requestJson(
    `/repos/${binding.repository}/actions/workflows/${path.basename(HEALTH_WORKFLOW_PATH)}`,
  );
  if (
    !jsonRecord(workflow) ||
    !Number.isSafeInteger(workflow.id) ||
    Number(workflow.id) <= 0 ||
    workflow.path !== HEALTH_WORKFLOW_PATH
  )
    throw new Error("Trusted health workflow identity unavailable");
  const policy: HealthPolicy = {
    repository: binding.repository,
    defaultBranch: binding.defaultBranch,
    workflowId: Number(workflow.id),
    workflowPath: HEALTH_WORKFLOW_PATH,
    artifactName: HEALTH_ARTIFACT_NAME,
    classificationPath: HEALTH_CLASSIFICATION_PATH,
    checks: inventory.checks.map((check) => ({
      checkId: check.id,
      scope: validationCheckHealthScope(check.profile),
    })),
  };
  return policy;
}

async function loadCiRuntime(rootDir: string): Promise<ValidationCiRuntime> {
  const modulePath = path.join(
    import.meta.dirname,
    "harness-validation-runtime.ts",
  );
  const runtime = await import(modulePath);
  if (typeof runtime.createValidationCiRuntime !== "function")
    throw new Error("Qualified native CI runtime adapter unavailable");
  return runtime.createValidationCiRuntime(rootDir);
}

/** One native execution owns the complete canonical plan. All five required
 * contexts depend on its complete verified result, including contexts whose
 * checks were legitimately not selected. Neither uploaded selection nor partial
 * per-job outputs can make an otherwise failed native execution green.
 */
export async function summarizeHostedValidation(input: {
  binding: HostedValidationBinding;
  executionJobResult: string;
  recomputePlan: (binding: HostedValidationBinding) => Promise<ValidationPlan>;
  verifyExecution: (
    plan: ValidationPlan,
    binding: HostedValidationBinding,
  ) => Promise<VerifiedHostedValidation>;
}) {
  let conclusion: "success" | "failure" = "failure";
  let reason = "Native hosted validation unavailable";
  let planDigest: string | undefined;
  let checkIds: string[] = [];
  try {
    if (input.executionJobResult !== "success")
      throw new Error("Native execution job did not succeed");
    if (
      typeof input.recomputePlan !== "function" ||
      typeof input.verifyExecution !== "function"
    )
      throw new Error(
        "Pinned plan recomputation and native verification are required",
      );
    const plan = await input.recomputePlan(input.binding);
    if (
      !plan.checks.length ||
      new Set(plan.checks.map((c) => c.id)).size !== plan.checks.length
    )
      throw new Error("Canonical plan is incomplete");
    planDigest = plan.digest;
    checkIds = plan.checks.map((c) => c.id);
    const verified = await input.verifyExecution(plan, input.binding);
    const bound = (value: HealthRunIdentity) =>
      value.repository === input.binding.repository &&
      value.runId === input.binding.runId &&
      value.runAttempt === input.binding.runAttempt &&
      value.headSha === input.binding.headSha;
    if (
      !bound(verified) ||
      verified.baseSha !== input.binding.baseSha ||
      verified.planDigest !== plan.digest ||
      !verified.recordRef.trim() ||
      verified.checks.length !== plan.checks.length ||
      new Set(verified.checks.map((c) => c.checkId)).size !==
        verified.checks.length
    )
      throw new Error(
        "Native record does not match complete pinned hosted plan",
      );
    for (const check of plan.checks) {
      const result = verified.checks.find((c) => c.checkId === check.id);
      if (
        !result ||
        !bound(result) ||
        result.identity !== check.identity ||
        result.profile !== check.profile ||
        result.outcome !== "success" ||
        result.originalExitCode !== 0 ||
        result.attributed !== false ||
        !["executed", "reused"].includes(result.execution) ||
        (plan.mode === "full-health" && result.execution !== "executed")
      )
        throw new Error(
          `Selected check ${check.id} lacks compatible successful evidence`,
        );
    }
    conclusion = "success";
    reason =
      "Complete native record and every canonical selected check verified";
  } catch (error) {
    reason =
      error instanceof Error
        ? error.message
        : "Native hosted validation unavailable";
  }
  return {
    planDigest,
    checkIds,
    contexts: Object.fromEntries(
      REQUIRED_VALIDATION_CONTEXTS.map((context) => [
        context,
        { conclusion, reason },
      ]),
    ),
  };
}

/** The workflow-facing boundary. Its callback must use native full-inventory
 * verification and hosted provenance before returning execution observations.
 * No optional verifier or uploaded result file can supply publication authority.
 * Failed inventories need a separately authenticated failure readout; this
 * wrapper intentionally does not turn a failed native verifier into success.
 */
export async function createVerifiedValidationHealthDigest(
  input: Omit<
    Parameters<typeof createValidationHealthDigest>[0],
    "observations"
  > & {
    verifyFullInventory: () => Promise<HealthObservation[]>;
  },
): Promise<HealthDigest> {
  if (input.run.runAttempt !== 1)
    throw new Error(
      "Full-health producer refuses GitHub reruns; dispatch a new full-health run to preserve earlier attempt history",
    );
  if (typeof input.verifyFullInventory !== "function")
    throw new Error(
      "Native full-inventory verification is required before health publication",
    );
  return createValidationHealthDigest({
    ...input,
    observations: await input.verifyFullInventory(),
  });
}

export function createValidationHealthDigest(input: {
  policy: HealthPolicy;
  run: HealthRunIdentity;
  observations: HealthObservation[];
  previous: HealthSnapshot;
  bootstrap?: boolean;
  /** Explicit incident recovery only. Retains uncertainty until a separately
   * approved global closure; cannot convert API outage into empty history. */
  recoverUnknownHistory?: boolean;
}): HealthDigest {
  const { policy, run, previous } = input;
  if (
    run.repository !== policy.repository ||
    !/^[a-f0-9]{40}$/.test(run.headSha) ||
    !Number.isSafeInteger(run.runId) ||
    run.runId <= 0 ||
    !Number.isSafeInteger(run.runAttempt) ||
    run.runAttempt <= 0 ||
    policy.checks.length === 0 ||
    policy.checks.some(
      (c) => !c.checkId.trim() || c.checkId === HEALTH_HISTORY_CHECK_ID,
    ) ||
    new Set(policy.checks.map((c) => c.checkId)).size !== policy.checks.length
  ) {
    throw new Error("Invalid full-health run or policy inventory");
  }
  const recovery =
    input.recoverUnknownHistory === true &&
    ["artifact-unavailable", "incomplete"].includes(previous.availability) &&
    previous.historyComplete !== true;
  if (
    recovery &&
    (!previous.lastAttempt ||
      !Number.isSafeInteger(previous.lastAttempt.runAttempt) ||
      (previous.lastAttempt.runAttempt ?? 0) <= 0 ||
      !/^[a-f0-9]{40}$/.test(previous.lastAttempt.headSha))
  ) {
    throw new Error(
      "Unknown-history recovery requires authenticated origin run and attempt",
    );
  }
  if (previous.availability === "missing-seed") {
    if (
      !input.bootstrap ||
      previous.lastAttempt ||
      previous.lastComplete ||
      previous.findings.length ||
      previous.closedFindings.length
    ) {
      throw new Error(
        "Explicit initial bootstrap requires no prior health observation",
      );
    }
  } else if (
    !recovery &&
    (!["available", "overdue", "incomplete"].includes(previous.availability) ||
      previous.historyComplete !== true ||
      !previous.lastComplete)
  ) {
    // An outage or a missing artifact is not proof that no historical failures
    // exist. Refuse publication, leaving the consumer visibly unavailable.
    throw new Error("Cannot publish without complete trusted health history");
  }
  if (
    [previous.lastAttempt, previous.lastComplete].some(
      (r) => r && r.runId > run.runId,
    )
  ) {
    throw new Error("Cannot replace newer health history with an older run");
  }
  const observations = new Map<string, HealthObservation>();
  for (const observation of input.observations) {
    if (!policy.checks.some((c) => c.checkId === observation.checkId))
      throw new Error("Unknown health check observation");
    if (observations.has(observation.checkId))
      throw new Error("Duplicate health check observation");
    observations.set(observation.checkId, observation);
  }
  const findings = new Map<string, HealthDigest["findings"][number]>();
  // Retain closed entries too. Only the reader's current protected-main approval
  // and successful revalidation can close them; revocation must remain effective.
  for (const finding of [
    ...previous.findings,
    ...previous.closedFindings.map((c) => c.finding),
  ]) {
    const value = {
      id: finding.id,
      revision: finding.revision,
      checkId: finding.checkId,
      runId: finding.runId,
      ...(finding.runAttempt !== undefined
        ? { runAttempt: finding.runAttempt }
        : {}),
      headSha: finding.headSha,
    };
    const retained = findings.get(value.id);
    if (retained && JSON.stringify(retained) !== JSON.stringify(value))
      throw new Error("Conflicting health finding history");
    findings.set(value.id, value);
  }
  const checks = policy.checks.map(({ checkId }) => {
    const observation = observations.get(checkId);
    let outcome: HealthDigest["checks"][number]["outcome"] = "unavailable";
    if (
      observation &&
      observation.repository === run.repository &&
      observation.runId === run.runId &&
      observation.runAttempt === run.runAttempt &&
      observation.headSha === run.headSha &&
      observation.execution === "executed"
    ) {
      if (observation.outcome === "cancelled") outcome = "cancelled";
      else if (
        Number.isSafeInteger(observation.originalExitCode) &&
        observation.originalExitCode !== null &&
        observation.originalExitCode !== 0
      )
        outcome = "failure";
      else if (observation.outcome === "failure") outcome = "failure";
      else if (
        observation.outcome === "success" &&
        observation.originalExitCode === 0 &&
        observation.attributed === false
      )
        outcome = "success";
    }
    if (outcome === "failure") {
      const revision = createHash("sha256")
        .update(JSON.stringify({ ...run, checkId }))
        .digest("hex");
      const id = `health:${run.runId}:${run.runAttempt}:${checkId}`;
      findings.set(id, {
        id,
        revision,
        checkId,
        runId: run.runId,
        headSha: run.headSha,
      });
    }
    return { checkId, outcome };
  });
  if (recovery) {
    if (checks.some((c) => c.outcome !== "success"))
      throw new Error(
        "Unknown-history recovery requires complete successful fresh execution",
      );
    const origin = previous.lastAttempt!;
    const id = `health-history:${policy.workflowId}:${origin.runId}:${origin.runAttempt}`;
    const revision = createHash("sha256")
      .update(
        JSON.stringify({ policy, origin, healthRevision: previous.revision }),
      )
      .digest("hex");
    if (!findings.has(id))
      findings.set(id, {
        id,
        revision,
        checkId: HEALTH_HISTORY_CHECK_ID,
        runId: origin.runId,
        runAttempt: origin.runAttempt,
        headSha: origin.headSha,
      });
  }
  return {
    schemaVersion: "athena-validation-health-digest/1",
    ...run,
    complete: checks.every(
      (c) => c.outcome === "success" || c.outcome === "failure",
    ),
    checks,
    findings: [...findings.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function runValidationCiBoundary() {
  try {
    await runValidationCiCli(Bun.argv.slice(2));
  } catch (error) {
    throw new HarnessBlockedError([
      createHarnessBlocker({
        code: "validation_ci_failed",
        source: { kind: "command", id: "harness:validation-ci" },
        summary:
          "Hosted validation did not establish a complete trusted result.",
        details:
          error instanceof Error
            ? error.message
            : "Unknown CI validation failure",
        remediations: [
          {
            id: "resolve-hosted-validation",
            kind: "manual_action",
            summary:
              "Inspect artifacts/validation-ci and the diagnostic. Restore authenticated metadata or repair failed checks/native verification before a new run. For a health rerun, dispatch a new workflow run instead.",
          },
        ],
      }),
    ]);
  }
}

if (import.meta.main) {
  process.exitCode = await runHarnessCliBoundary({
    source: { kind: "command", id: "harness:validation-ci" },
    reproduce: [
      "bun",
      "run",
      "harness:validation-ci",
      "--",
      ...Bun.argv.slice(2),
    ],
    run: runValidationCiBoundary,
  });
}

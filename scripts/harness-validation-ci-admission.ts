import type { VerifiedHostedValidation } from "./harness-validation-ci";
import type { ValidationPlan } from "./harness-validation-plan";
import {
  evaluateValidationHealth,
  type HealthSnapshot,
} from "./harness-validation-health";
import {
  healthCandidateScopes,
  validationCheckHealthScope,
} from "./harness-validation-ci-policy";

/** The caller supplies independently verified native evidence and a fresh trusted
 * health read. Keep the original native-bound revision on every projected proof. */
export function admitFinalValidationHealth(input: {
  plan: ValidationPlan;
  verified: VerifiedHostedValidation;
  candidateRef: string;
  plannedHealthRevision: string;
  health: HealthSnapshot;
}) {
  const { plan, verified, candidateRef, plannedHealthRevision, health } = input;
  if (
    !candidateRef.trim() ||
    !plannedHealthRevision.trim() ||
    !verified.recordRef.trim() ||
    verified.planDigest !== plan.digest ||
    !plan.checks.length ||
    new Set(plan.checks.map((check) => check.id)).size !== plan.checks.length ||
    verified.checks.length !== plan.checks.length ||
    new Set(verified.checks.map((check) => check.checkId)).size !==
      plan.checks.length ||
    plan.checks.some((check) => {
      const row = verified.checks.find((row) => row.checkId === check.id);
      return (
        !row ||
        row.identity !== check.identity ||
        row.profile !== check.profile ||
        row.outcome !== "success" ||
        row.attributed !== false ||
        row.originalExitCode !== 0 ||
        row.repository !== verified.repository ||
        row.headSha !== verified.headSha ||
        row.runId !== verified.runId ||
        row.runAttempt !== verified.runAttempt ||
        (plan.mode === "full-health" && row.execution !== "executed")
      );
    })
  )
    throw new Error(
      "Final health admission requires complete verified native checks",
    );
  const proof = {
    candidateRef,
    profile: "hosted" as const,
    healthRevision: plannedHealthRevision,
    outcome: "success" as const,
    evidenceRef: verified.recordRef,
  };
  const decision = evaluateValidationHealth({
    health,
    candidate: {
      candidateRef,
      profile: "hosted",
      scopes: healthCandidateScopes(plan.changes),
    },
    plannedHealthRevision,
    // A canonical check id can survive selected-test narrowing. Only the
    // independently recomputed full inventory proves a health check was repaired.
    proofs: (plan.mode === "full-health" ? health.findings : []).flatMap(
      (finding) => {
        const check = plan.checks.find((check) => check.id === finding.checkId);
        return check
          ? [
              {
                ...proof,
                findingId: finding.id,
                findingRevision: finding.revision,
                checkId: check.id,
                scope: validationCheckHealthScope(check.profile),
              },
            ]
          : [];
      },
    ),
    ...(plan.mode === "full-health"
      ? { fullValidation: { ...proof, mode: "full-health" as const } }
      : {}),
  });
  if (decision.status !== "eligible")
    throw new Error(
      `Final validation health refused admission: ${decision.reason}`,
    );
  return decision;
}

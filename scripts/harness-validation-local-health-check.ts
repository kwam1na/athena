import { isDeepStrictEqual } from "node:util";
import {
  assertLocalValidationHealthCurrent,
  LOCAL_HEALTH_OBLIGATION,
  LOCAL_HEALTH_PROVIDER,
  type LocalValidationHealthContext,
} from "./harness-validation-local-health.ts";
import type { configureLocalScopedValidation } from "./harness-validation-local-runtime.ts";

type Current = Awaited<ReturnType<typeof configureLocalScopedValidation>>;

export function checkLocalValidationHealth(
  original: LocalValidationHealthContext,
  request: unknown,
  current: Current,
) {
  const payload = request as Record<string, unknown> | null;
  const candidate = payload?.candidate as Record<string, unknown> | undefined;
  const expected = current.selection.candidate;
  if (
    !payload ||
    payload.gateId !== current.config.gateId ||
    payload.providerId !== LOCAL_HEALTH_PROVIDER ||
    !isDeepStrictEqual(payload.obligationIds, [LOCAL_HEALTH_OBLIGATION]) ||
    !candidate ||
    candidate.treeSha !== expected.treeSha ||
    candidate.headSha !== expected.headSha ||
    !isDeepStrictEqual(candidate.base, expected.base) ||
    !isDeepStrictEqual(candidate.deliverable, expected.deliverable)
  )
    throw new Error(
      "Local health request does not match the current native candidate and obligation.",
    );
  assertLocalValidationHealthCurrent(
    original,
    current.config,
    current.selection,
    current.fullSelection,
    current.authority,
  );
}

if (import.meta.main) {
  try {
    if (Bun.argv.length !== 4)
      throw new Error("Expected original health context and native request.");
    const original = JSON.parse(Bun.argv[2]);
    const request = JSON.parse(Bun.argv[3]);
    // Loading the actual candidate config recollects trusted authority and
    // source selection. Incoming context never supplies authority or a plan.
    const { ATHENA_LOCAL_VALIDATION } = await import("../harness.config.ts");
    if (!ATHENA_LOCAL_VALIDATION)
      throw new Error("Local scoped validation is not enabled.");
    checkLocalValidationHealth(original, request, ATHENA_LOCAL_VALIDATION);
    console.log(JSON.stringify({ healthCurrent: true }));
  } catch (error) {
    console.error(
      JSON.stringify({
        schemaVersion: 1,
        blockers: [
          {
            code: "local_validation_health_failed",
            source: { kind: "command", id: "harness:local-health" },
            summary:
              "Current trusted health does not authorize this validation context.",
            details: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 8000),
            remediations: [
              {
                id: "replan-local-health",
                kind: "manual_action",
                summary:
                  "Read current health and prepare the canonical selection again before admission.",
              },
            ],
          },
        ],
      }),
    );
    process.exitCode = 1;
  }
}

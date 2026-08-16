import type { OperationDefinition } from "../types";
import { defineOperation } from "./_shapes";

/**
 * U8 - reports and the auth bridge retirement - write/action/http operation definitions.
 *
 * All five range mutations carry `reporting.generate`, which is the capability
 * `classifyAthenaPublicWrite` already assigns to every `reports/*` module and
 * is deliberately NOT in `SHARED_DEMO_ALLOWED_CAPABILITIES`. So
 * `actors.sharedDemo: "deny"` is the exact successor to the retired
 * `requireSharedDemoCapabilityIfApplicable(ctx, "reporting.generate")` calls
 * in `skuMixRange.ts` / `skuMovementRange.ts`: a demo visitor could never
 * generate a range snapshot and still cannot.
 *
 * `reports/customRange:requestRange` had no demo capability check of its own —
 * it inherited the `reports.read` gate, which the demo does hold. Bringing it
 * under `reporting.generate` denies the demo actor there too. That is a
 * NARROWING, never a widening: range generation is the same effect on all
 * three modules, and the catalog already classified `reports/customRange` as
 * `reporting.generate`, so the previous asymmetry was the drift.
 *
 * Because the demo is denied, none of these needs `store_write` readiness (the
 * restore fence exists to protect demo writes) and none carries a `target`
 * guard — no reports mutation ever touched a demo foundation row, so there is
 * no retired `requireNonDemoFoundationMutation` site in this unit.
 *
 * The reports authorization gate itself (single `full_admin` membership in the
 * store's owning organization, one opaque failure message) is domain
 * authorization rather than actor policy and stays in `reports/access.ts`,
 * invoked by every handler after admission.
 */

/** Store-scoped range generation: the shape all five range mutations share. */
function defineRangeGenerationOperation(
  functionName: string,
  operationId: string,
) {
  return defineOperation({
    kind: "mutation" as const,
    functionName,
    operationId,
    capability: "reporting.generate" as const,
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

export const requestRangeOperationDefinition = defineRangeGenerationOperation(
  "reports/customRange:requestRange",
  "reports/customRange.requestRange",
);

export const ensureMixRangeOperationDefinition = defineRangeGenerationOperation(
  "reports/skuMixRange:ensureMixRange",
  "reports/skuMixRange.ensureMixRange",
);

export const retryMixRangeOperationDefinition = defineRangeGenerationOperation(
  "reports/skuMixRange:retryMixRange",
  "reports/skuMixRange.retryMixRange",
);

export const ensureMovementRangeOperationDefinition =
  defineRangeGenerationOperation(
    "reports/skuMovementRange:ensureMovementRange",
    "reports/skuMovementRange.ensureMovementRange",
  );

export const retryMovementRangeOperationDefinition =
  defineRangeGenerationOperation(
    "reports/skuMovementRange:retryMovementRange",
    "reports/skuMovementRange.retryMovementRange",
  );

export const U8_REPORTS_OPERATION_DEFINITIONS: readonly OperationDefinition[] = [
  requestRangeOperationDefinition,
  ensureMixRangeOperationDefinition,
  retryMixRangeOperationDefinition,
  ensureMovementRangeOperationDefinition,
  retryMovementRangeOperationDefinition,
];

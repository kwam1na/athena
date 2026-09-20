import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATHENA_LEGACY_CONFIG,
  resolveAthenaValidationMode,
} from "./scripts/harness-base-config.ts";
export {
  ATHENA_LEGACY_CONFIG,
  ATHENA_PR_VALIDATION_GATE_ID,
} from "./scripts/harness-base-config.ts";

// Qualification remains opt-in until V26-2071 acceptance. Explicit legacy is
// the rollback path after a separately reviewed default activation.
const validationMode = resolveAthenaValidationMode(
  process.env.ATHENA_VALIDATION_MODE,
  "legacy",
);
export const ATHENA_LOCAL_VALIDATION =
  validationMode !== "legacy"
    ? await (
        await import("./scripts/harness-validation-local-runtime.ts")
      ).configureLocalScopedValidation(
        dirname(fileURLToPath(import.meta.url)),
        ATHENA_LEGACY_CONFIG,
        validationMode,
      )
    : undefined;
export default ATHENA_LOCAL_VALIDATION?.config ?? ATHENA_LEGACY_CONFIG;

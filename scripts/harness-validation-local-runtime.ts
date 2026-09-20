import type { HarnessConfig } from "../.agent-skills/current/runtime/kernel.mjs";
import { captureNativeValidationSelection } from "./harness-validation-load.ts";
import { configureScopedValidation } from "./harness-validation-runtime.ts";
import {
  bindLocalValidationHealth,
  chooseLocalValidationMode,
  LocalValidationHealthError,
  type LocalHealthAuthority,
  type LocalValidationMode,
} from "./harness-validation-local-health.ts";

/** Source capture stays credential-free; only the parent reads trusted health.
 * The returned live obligation and mandatory native checks are conjunctive. */
export async function configureLocalScopedValidation(
  rootDir: string,
  base: HarnessConfig,
  requested: LocalValidationMode,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: {
    capture?: typeof captureNativeValidationSelection;
    readAuthority?: (rootDir: string) => Promise<LocalHealthAuthority>;
    now?: () => number;
  } = {},
) {
  const capture = dependencies.capture ?? captureNativeValidationSelection;
  const readAuthority =
    dependencies.readAuthority ??
    (async (root: string) =>
      (
        await import("./harness-validation-local-authority.ts")
      ).readLocalValidationAuthority(root));
  const authority = await readAuthority(rootDir);
  const initial = capture(rootDir, base, requested);
  const now = dependencies.now?.() ?? Date.now();
  const mode = chooseLocalValidationMode(
    authority.health,
    initial.plan.changes,
    requested,
    now,
  );
  const selection = mode === requested ? initial : capture(rootDir, base, mode);
  if (
    initial.candidate.treeSha !== selection.candidate.treeSha ||
    initial.candidate.headSha !== selection.candidate.headSha ||
    initial.candidate.base.tipSha !== selection.candidate.base.tipSha ||
    initial.candidate.base.mergeBaseSha !==
      selection.candidate.base.mergeBaseSha
  )
    throw new LocalValidationHealthError(
      "local_health_candidate_changed",
      "Candidate changed while selecting full validation; prepare again.",
    );
  // Complete capture is already canonical. Comparison admission needs no
  // fictitious full proof; its fullSelection argument is unused in that mode.
  const fullSelection = selection;
  const projected = configureScopedValidation(
    rootDir,
    base,
    mode,
    env,
    () => selection,
  );
  const bound = bindLocalValidationHealth(
    projected.config,
    selection,
    fullSelection,
    authority,
    now,
  );
  Object.assign(env, bound.environment);
  return { ...bound, selection, fullSelection, authority };
}

import type {
  HarnessConfig,
  ScopedExecutionProfile,
} from "../.agent-skills/current/runtime/kernel.mjs";
import {
  captureNativeValidationSelection,
  type NativeValidationSelection,
} from "./harness-validation-load.ts";
import { projectValidationPolicy } from "./harness-validation-policy.ts";
import {
  isMechanicalValidationCheck,
  validationCheckCommand,
} from "./harness-validation-command.ts";
import type { CanonicalValidationCheck } from "./harness-app-registry.ts";
import qualifiedFrontend from "./fixtures/affected-validation/frontend-qualified-profiles.json" with { type: "json" };
import type { ValidationPlanMode } from "./harness-validation-plan.ts";

const flags = [
  "CI",
  "NODE_ENV",
  "TZ",
  "PYTHONDONTWRITEBYTECODE",
  "ATHENA_GRAPHIFY_PYTHON",
  "PLAYWRIGHT_BROWSERS_PATH",
  "ATHENA_PROD_CONVEX_URL",
  "ATHENA_PROD_CONVEX_SITE_URL",
  "VITE_CONVEX_URL",
  "VITE_CONVEX_SITE_URL",
];

// Vitest's pinned unnamed project writes timing results here. Grant only that
// generated file, never its dependency directory or Vite's executable cache.
const vitestResults = (pkg: string) =>
  `packages/${pkg}/.cache/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`;

/** Only qualified command/membership tuples use file-only snapshots.
 * Unqualified checks retain private Git and their existing output permissions. */
export function configureScopedValidation(
  rootDir: string,
  base: HarnessConfig,
  mode: ValidationPlanMode,
  env: NodeJS.ProcessEnv = process.env,
  capture = captureNativeValidationSelection,
) {
  if (!["comparison", "full-health", "delivery"].includes(mode))
    throw new Error("Unsupported native validation mode");
  const selection = capture(rootDir, base, mode);
  const dependencyInputs = selection.inventory.filter(
    (file) =>
      file === "bun.lockb" ||
      file === "bun.lock" ||
      file === "package.json" ||
      /^packages\/[^/]+\/package\.json$/.test(file),
  );
  const profile = (
    id: string,
    mutableOutputs: string[],
    kind: "core" | "browser" = "core",
    gitContext: "full" | "none" = "full",
  ): ScopedExecutionProfile => ({
    id,
    gitContext,
    dependencyInputs: [
      ...dependencyInputs,
      "scripts/harness-validation-dependencies.py",
      ".graphify-validation-requirements.lock",
    ],
    dependencies: {
      command: ["python3", "scripts/harness-validation-dependencies.py", kind],
      timeoutMs: 1800000,
    },
    mutableOutputs,
    credentialIdentities: {},
  });
  // Outputs are write permissions, never a way to exclude tracked source from
  // native snapshots. Keep read-only checks separate from artifact producers.
  const profiles = [
    profile("athena-core-full", []),
    profile("athena-typecheck-none", [], "core", "none"),
    profile("athena-webapp-unit-full", [vitestResults("athena-webapp")]),
    profile("athena-storefront-unit-full", [
      vitestResults("storefront-webapp"),
    ]),
    profile("athena-webapp-build-full", ["packages/athena-webapp/dist/"]),
    profile("athena-storefront-build-full", [
      "packages/storefront-webapp/dist/",
    ]),
    profile(
      "athena-webapp-unit-none",
      [vitestResults("athena-webapp")],
      "core",
      "none",
    ),
    profile(
      "athena-storefront-unit-none",
      [vitestResults("storefront-webapp")],
      "core",
      "none",
    ),
    profile(
      "athena-webapp-build-none",
      ["packages/athena-webapp/dist/"],
      "core",
      "none",
    ),
    profile(
      "athena-storefront-build-none",
      ["packages/storefront-webapp/dist/"],
      "core",
      "none",
    ),
    profile("athena-coverage-full", [
      "coverage/",
      "packages/athena-webapp/coverage/",
      "packages/storefront-webapp/coverage/",
      vitestResults("athena-webapp"),
      vitestResults("storefront-webapp"),
    ]),
    profile("athena-storybook-full", [
      "packages/athena-webapp/storybook-static/",
      "packages/athena-webapp/.cache/storybook-build/",
    ]),
    profile("athena-inferential-full", [
      "artifacts/harness-inferential-review/",
    ]),
    profile("athena-behavior-full", ["artifacts/harness-behavior/"], "browser"),
    profile(
      "athena-browser-full",
      ["artifacts/validation-playwright/", "packages/athena-webapp/dist/"],
      "browser",
    ),
    profile(
      "athena-storefront-browser-full",
      ["artifacts/validation-playwright/"],
      "browser",
    ),
  ];
  const configured = projectValidationPolicy(base, selection.plan, {
    profiles,
    profileByCheck: Object.fromEntries(
      selection.plan.checks.map((check) => [
        check.id,
        validationProfile(check, selection.packageScripts[check.cwd]),
      ]),
    ),
    mechanicalChecks: selection.plan.checks
      .filter(isMechanicalValidationCheck)
      .map((check) => check.id),
    environment: flags.map((name) => ({ name, kind: "flag" as const })),
    environmentByCheck: Object.fromEntries(
      selection.plan.checks.map((check) => [
        check.id,
        validationEnvironment(check),
      ]),
    ),
    packageScripts: selection.packageScripts,
  });
  // These coordinates are native-observed flags, not an uploaded receipt or
  // candidate-specific command. The first provider checks them inside private Git.
  const selectionEnv = selectionEnvironment(selection);
  Object.assign(env, selectionEnv, {
    PYTHONDONTWRITEBYTECODE: "1",
    ATHENA_GRAPHIFY_PYTHON: "private",
    PLAYWRIGHT_BROWSERS_PATH: "0",
    // The canonical Bun filter runs Storybook from the package directory.
    // Bind this only to that provider; dependencies remain immutable.
    CACHE_DIR: ".cache/storybook-build",
    // Both canonical Playwright commands run in their two-level package root,
    // including the root-owned `bun --filter` wrappers. The config outputDir
    // and HTML reporter therefore resolve these to the private repository root.
    PLAYWRIGHT_HTML_OUTPUT_DIR: "../../artifacts/validation-playwright/html",
    PLAYWRIGHT_OUTPUT_DIR: "../../artifacts/validation-playwright/results",
  });
  return { ...configured, selection };
}

function validationProfile(
  check: CanonicalValidationCheck,
  packageScripts?: Record<string, unknown>,
) {
  if (
    ["packages/athena-webapp", "packages/storefront-webapp"].includes(check.cwd)
  ) {
    if (check.profile === `${check.cwd}:unit`) {
      const mode = qualifiedFrontendCommand(check, packageScripts)
        ? "none"
        : "full";
      return check.cwd === "packages/athena-webapp"
        ? `athena-webapp-unit-${mode}`
        : `athena-storefront-unit-${mode}`;
    }
    if (check.profile === `${check.cwd}:package-types`)
      return "athena-typecheck-none";
    if (check.profile === `${check.cwd}:package-build`) {
      const mode = qualifiedFrontendCommand(check, packageScripts)
        ? "none"
        : "full";
      return check.cwd === "packages/athena-webapp"
        ? `athena-webapp-build-${mode}`
        : `athena-storefront-build-${mode}`;
    }
  }
  // These root-owned backend commands still run the package Vitest config.
  // Keep their broad inputs and full Git context; allow only its existing cache.
  if (
    check.cwd === "." &&
    ((check.profile === "packages/athena-webapp:fallback-suite" &&
      JSON.stringify(check.argv) ===
        JSON.stringify(["bun", "run", "--filter", "@athena/webapp", "test"])) ||
      (check.profile === "packages/athena-webapp:timer-stress" &&
        JSON.stringify(check.argv) ===
          JSON.stringify([
            "/bin/sh",
            "-c",
            "bun run --filter '@athena/webapp' test:timing-parity",
          ])))
  )
    return "athena-webapp-unit-full";
  if (check.profile === "packages/athena-webapp:browser")
    return "athena-browser-full";
  if (check.profile === "packages/storefront-webapp:browser")
    return "athena-storefront-browser-full";
  if (check.profile === ".:behavior") return "athena-behavior-full";
  if (check.profile === ".:aggregate-coverage") return "athena-coverage-full";
  const command = check.argv.join(" ");
  if (isStorybookBuild(check)) return "athena-storybook-full";
  if (command.includes("harness:inferential-review"))
    return "athena-inferential-full";
  return "athena-core-full";
}

function qualifiedFrontendCommand(
  check: CanonicalValidationCheck,
  packageScripts?: Record<string, unknown>,
) {
  const candidates = qualifiedFrontend.commands.filter(
    (entry) =>
      entry.cwd === check.cwd &&
      JSON.stringify(entry.membership) === JSON.stringify(check.membership) &&
      entry.plannerDefinitions.some(
        (definition) =>
          definition.profile === check.profile &&
          JSON.stringify(definition.argv) === JSON.stringify(check.argv),
      ),
  );
  if (!candidates.length) return false;
  const command = validationCheckCommand(check, { packageScripts });
  return candidates.some(
    (entry) => JSON.stringify(entry.command) === JSON.stringify(command),
  );
}

export function selectionEnvironment(selection: NativeValidationSelection) {
  return {
    ATHENA_SELECTION_HEAD: selection.candidate.headSha,
    ATHENA_SELECTION_TREE: selection.candidate.treeSha,
    ATHENA_SELECTION_BASE: selection.candidate.base.tipSha,
    ATHENA_SELECTION_MERGE_BASE: selection.candidate.base.mergeBaseSha,
  };
}

/** Credentials reach only the existing sensor that needs them. Without an
 * external secret revision the native product correctly refuses evidence reuse. */
export function validationEnvironment(check: {
  profile: string;
  argv: readonly string[];
  cwd?: string;
}) {
  const command = check.argv.join(" ");
  const environment: Array<{ name: string; kind: "flag" | "credential" }> = [];
  if (isStorybookBuild(check))
    environment.push({ name: "CACHE_DIR", kind: "flag" });
  if (check.profile.endsWith(":browser"))
    environment.push(
      { name: "PLAYWRIGHT_HTML_OUTPUT_DIR", kind: "flag" },
      { name: "PLAYWRIGHT_OUTPUT_DIR", kind: "flag" },
    );
  if (command.includes("harness:inferential-review"))
    environment.push(
      { name: "HARNESS_INFERENTIAL_SEMANTIC_MODE", kind: "flag" },
      { name: "ANTHROPIC_API_KEY", kind: "credential" },
    );
  if (
    check.profile.endsWith(":browser") &&
    command.includes("test:e2e:prod:pos")
  )
    environment.push(
      { name: "ATHENA_POS_E2E_RUN_LOCAL_BUILD", kind: "flag" },
      { name: "ATHENA_PROD_POS_STORE_ID", kind: "flag" },
      { name: "ATHENA_PROD_POS_HUB_PATH", kind: "flag" },
      { name: "ATHENA_PROD_POS_RECOVERY_CODE", kind: "credential" },
    );
  if (check.profile.includes("coverage"))
    environment.push({ name: "ATHENA_COVERAGE_MAX_WORKERS", kind: "flag" });
  return environment;
}

function isStorybookBuild(check: {
  profile: string;
  argv: readonly string[];
  cwd?: string;
}) {
  return (
    check.cwd === "." &&
    check.profile === "packages/athena-webapp:command" &&
    JSON.stringify(check.argv) ===
      JSON.stringify([
        "/bin/sh",
        "-c",
        "bun run --filter '@athena/webapp' storybook:build",
      ])
  );
}

export async function createValidationCiRuntime(rootDir: string) {
  // Hosted adapter includes Bun analysis modules; keep them out of Node's local
  // harness.config loader until the hosted command explicitly requests them.
  return (
    await import("./harness-validation-ci-adapter.ts")
  ).createValidationCiRuntime(rootDir);
}

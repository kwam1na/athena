import type { CanonicalValidationCheck } from "./harness-app-registry";

export function validationCheckCommand(
  check: CanonicalValidationCheck,
  options: {
    packageScripts?: Record<string, unknown>;
  } = {},
): string[] {
  // Hosted callers bind baseRef to a SHA, so a private snapshot need not expose
  // origin/main. Preserve the authored scripts while supplying its pinned ref.
  if (check.cwd === ".") {
    const rootScripts = {
      "landed-report:check":
        "bun scripts/landed-change-report-check.ts --base origin/main",
      "harness:inferential-review": "bun scripts/harness-inferential-review.ts",
    };
    for (const [name, script] of Object.entries(rootScripts)) {
      if (
        JSON.stringify(check.argv) === JSON.stringify(["bun", "run", name]) ||
        JSON.stringify(check.argv) ===
          JSON.stringify(["/bin/sh", "-c", `bun run ${name}`])
      ) {
        if (options.packageScripts?.[name] !== script)
          throw new Error(`Uncharacterized base-aware script ${name}`);
        return ["bun", "run", name, "--base", "refs/delivery/base"];
      }
    }
    for (const [script, variable] of [
      ["lint:convex:changed", "CONVEX_LINT_BASE_REF"],
      ["lint:frontend:changed", "FRONTEND_LINT_BASE_REF"],
    ]) {
      const command = `bun run --filter '@athena/webapp' ${script}`;
      if (
        JSON.stringify(check.argv) ===
        JSON.stringify(["/bin/sh", "-c", command])
      )
        return ["/bin/sh", "-c", `${variable}=refs/delivery/base ${command}`];
    }
  }
  const packageOwned = [
    "packages/athena-webapp",
    "packages/storefront-webapp",
  ].includes(check.cwd);
  const pipelineScript =
    check.profile === `${check.cwd}:package-types`
      ? "typecheck"
      : check.profile === `${check.cwd}:package-build`
        ? "build:assets"
        : undefined;
  if (packageOwned && pipelineScript) {
    // Only the characterized pipeline may share the explicit typecheck obligation.
    // Captured manifest text must supply these scripts; ambient files are not evidence.
    const scripts = options.packageScripts;
    const lifecycle = ["build", "build:assets", "typecheck"].flatMap((name) => [
      `pre${name}`,
      `post${name}`,
    ]);
    if (
      scripts?.build !== "vite build && tsc --noEmit" ||
      scripts?.["build:assets"] !== "vite build" ||
      scripts?.typecheck !== "tsc --noEmit" ||
      lifecycle.some((name) => scripts?.[name] !== undefined) ||
      JSON.stringify(check.argv) !==
        JSON.stringify(["bun", "run", pipelineScript])
    )
      throw new Error(`Uncharacterized build pipeline for ${check.cwd}`);
    return [...check.argv];
  }
  const rootUnit =
    check.cwd === "." &&
    JSON.stringify(check.argv) ===
      JSON.stringify(["/bin/sh", "-c", "bun run harness:test"]);
  const packageUnit =
    ["packages/athena-webapp", "packages/storefront-webapp"].includes(
      check.cwd,
    ) &&
    check.profile === `${check.cwd}:unit` &&
    JSON.stringify(check.argv) === JSON.stringify(["bun", "run", "test", "--"]);
  if (rootUnit || packageUnit) {
    const membership = [...new Set(check.membership)].sort();
    if (membership.length === 0)
      throw new Error(`Empty test membership for ${check.id}`);
    if (rootUnit) {
      if (membership.some((file) => !/^scripts\/[^/\\]+\.test\.ts$/.test(file)))
        throw new Error(`Invalid root test membership for ${check.id}`);
      return [
        "bun",
        "run",
        "harness:test",
        ...membership.flatMap((file) => ["--test-file", file]),
      ];
    }
    const prefix = `${check.cwd}/`;
    if (
      membership.some(
        (file) =>
          !file.startsWith(prefix) ||
          file.includes("\\") ||
          file.split("/").includes(".."),
      )
    )
      throw new Error(`Test membership escapes ${check.cwd}`);
    const expectedScript =
      check.cwd === "packages/athena-webapp"
        ? "vitest run --maxWorkers=4"
        : "vitest run";
    if (
      options.packageScripts?.test !== expectedScript ||
      options.packageScripts?.pretest !== undefined ||
      options.packageScripts?.posttest !== undefined
    )
      throw new Error(`Uncharacterized test script for ${check.cwd}`);
    return [
      "node",
      "../../scripts/harness-vitest-membership.mjs",
      ...membership.flatMap((file) => [
        "--test-file",
        file.slice(prefix.length),
      ]),
      ...(check.cwd === "packages/athena-webapp" ? ["--max-workers", "4"] : []),
    ];
  }
  return [...check.argv];
}

export const MECHANICAL_PACKAGE_SCRIPTS = [
  "lint:convex:changed",
  "lint:frontend:changed",
  "lint:architecture",
] as const;

/**
 * Registry `raw` commands that qualify as mechanical. Matched by shape rather
 * than by a copied literal so a registry edit cannot silently drop the check,
 * and kept strict enough that the command can be spawned as argv with no shell:
 * anything carrying an operator, redirect, or extra argument fails the match.
 */
const MECHANICAL_RAW_COMMAND_PATTERN =
  /^bunx tsc --noEmit -p packages\/[a-z0-9-]+\/tsconfig\.json$/;

export function isMechanicalRawCommand(command: string) {
  return MECHANICAL_RAW_COMMAND_PATTERN.test(command.trim());
}

/** Same deterministic mechanics as preparation, recognized before spawning any
 * review. Extra shell syntax remains an ordinary check rather than being guessed. */
export function isMechanicalValidationCheck(check: CanonicalValidationCheck) {
  if (
    ["packages/athena-webapp", "packages/storefront-webapp"].includes(
      check.cwd,
    ) &&
    check.profile === `${check.cwd}:package-types` &&
    JSON.stringify(check.argv) === JSON.stringify(["bun", "run", "typecheck"])
  )
    return true;
  if (
    check.cwd !== "." ||
    check.argv.length !== 3 ||
    check.argv[0] !== "/bin/sh" ||
    check.argv[1] !== "-c"
  )
    return false;
  if (isMechanicalRawCommand(check.argv[2])) return true;
  return ["@athena/webapp", "@athena/storefront-webapp"].some((workspace) =>
    MECHANICAL_PACKAGE_SCRIPTS.some(
      (script) => check.argv[2] === `bun run --filter '${workspace}' ${script}`,
    ),
  );
}

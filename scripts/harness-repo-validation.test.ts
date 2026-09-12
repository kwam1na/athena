import { describe, expect, it } from "vitest";

import {
  collectHarnessRepoValidationCapabilities,
  collectHarnessRepoValidationSelection,
  matchesHarnessRepoValidationPath,
} from "./harness-repo-validation";

describe("matchesHarnessRepoValidationPath", () => {
  it.each([
    "scripts/harness-review.ts",
    "scripts/pre-push-review.ts",
    "packages/athena-webapp/docs/agent/testing.md",
    "packages/athena-webapp/AGENTS.md",
    "packages/AGENTS.md",
    "README.md",
    "package.json",
    "manage-athena-versions.sh",
    ".github/workflows/athena-pr-tests.yml",
    ".husky/pre-commit",
    ".husky/pre-push",
  ])("matches repo-owned harness path %s", (filePath) => {
    expect(matchesHarnessRepoValidationPath(filePath)).toBe(true);
  });

  it.each([
    "packages/athena-webapp/src/app.ts",
    "packages/storefront-webapp/src/routes/index.tsx",
    "graphify-out/GRAPH_REPORT.md",
  ])("ignores non-repo harness path %s", (filePath) => {
    expect(matchesHarnessRepoValidationPath(filePath)).toBe(false);
  });
});

describe("collectHarnessRepoValidationCapabilities", () => {
  it("keeps repo validation capabilities narrower than the selected command names", () => {
    expect(collectHarnessRepoValidationCapabilities()).toEqual([
      {
        capability: "root-script-tests",
        commands: ["bun run harness:test"],
      },
    ]);
  });
});

describe("collectHarnessRepoValidationSelection", () => {
  it("returns the shared repo commands and coverage for repo-owned changes", () => {
    const selection = collectHarnessRepoValidationSelection([
      "README.md",
      "scripts/harness-review.ts",
      "scripts/harness-review.ts",
    ]);

    expect(selection.matchedFiles).toEqual([
      "README.md",
      "scripts/harness-review.ts",
    ]);
    expect(selection.matchedSurfaces).toEqual([
      {
        surfaceName: "repo harness implementation and workflow wiring",
        files: ["README.md", "scripts/harness-review.ts"],
      },
    ]);
    expect(selection.selectedCommands).toEqual([
      "bun run workflow:check",
      "bun run harness:test",
      "bun run delivery:documentation-check",
      "bun run test:coverage",
      "bun run harness:inferential-review",
    ]);
  });

  it("returns no coverage when only app-local files change", () => {
    const selection = collectHarnessRepoValidationSelection([
      "packages/athena-webapp/src/app.ts",
    ]);

    expect(selection.matchedFiles).toEqual([]);
    expect(selection.matchedSurfaces).toEqual([]);
    expect(selection.selectedCommands).toEqual([]);
  });
});

import { collectCanonicalValidationRegistry } from "./harness-repo-validation";
import { buildValidationPlan } from "./harness-validation-plan";

describe("derived canonical registry", () => {
  it("retains guarded runtime readers and resolves their executable obligations", () => {
    const registry = collectCanonicalValidationRegistry([]);
    const docs = registry.impact?.relationships.find(
      (relationship) => relationship.id === "docs-publishing",
    );
    expect(docs?.kind).toBe("data");
    expect(docs?.lazyProducers?.[
      "packages/athena-webapp/vite-docs-content-plugin.ts"
    ]).toMatch(/^[a-f0-9]{64}$/);
    expect(docs?.publishingChecks?.length).toBeGreaterThan(0);
    for (const id of docs?.publishingChecks ?? []) {
      expect(registry.checks.find((check) => check.id === id)?.profile).toBe(
        "docs-publishing",
      );
    }
    const styles = registry.impact?.relationships.find(
      (relationship) => relationship.id === "athena-webapp-style-data",
    );
    expect(styles?.guards?.[
      "packages/athena-webapp/tailwind.config.js"
    ]).toMatch(/^[a-f0-9]{64}$/);
    expect(styles?.boundedConsumers?.[
      "packages/athena-webapp/src/index.css"
    ]).toMatch(/^[a-f0-9]{64}$/);
    const admission = registry.impact?.relationships.find(
      (relationship) => relationship.id === "convex-function-admission",
    );
    expect(admission?.checks).toHaveLength(1);
    expect(registry.checks.find((check) => check.id === admission?.checks?.[0])?.argv)
      .toEqual(["/bin/sh", "-c", "bun scripts/convex-operation-admission-check.ts"]);
  });
  it("binds containing package fallbacks to executable suite, type and build checks", () => {
    const registry = collectCanonicalValidationRegistry([
      "packages/athena-webapp/src/example.test.ts",
    ]);
    const owner = registry.impact?.packages.find(
      (entry) => entry.root === "packages/athena-webapp",
    );
    expect(owner).toBeDefined();
    const fallbacks = (owner?.fallbackChecks ?? []).map((id) =>
      registry.checks.find((check) => check.id === id),
    );
    expect(fallbacks.every(Boolean)).toBe(true);
    for (const [profile, command] of [
      ["fallback-suite", "test"],
      ["package-types", "typecheck"],
      ["package-build", "build"],
    ]) {
      const check = fallbacks.find((entry) =>
        entry?.profile === `packages/athena-webapp:${profile}`,
      );
      expect(check?.cwd).toBe(".");
      expect(check?.argv).toEqual(["bun", "run", "--filter", "@athena/webapp", command]);
    }
  });
  it("selects publishing obligations for a report without application coverage", () => {
    const registry = collectCanonicalValidationRegistry([
      "scripts/one.test.ts",
    ]);
    const plan = buildValidationPlan(registry, [
      { path: "docs/reports/report.html", status: "modified" },
    ]);
    expect(new Set(plan.checks.map((check) => check.profile))).toEqual(
      new Set(["plan-integrity", "docs-publishing"]),
    );
    expect(plan.checks.some((check) => check.argv.includes("build"))).toBe(
      true,
    );
  });
  it("keeps full-health inventory nonempty on unchanged main", () => {
    const registry = collectCanonicalValidationRegistry([
      "packages/athena-webapp/src/example.test.ts",
      "scripts/one.test.ts",
    ]);
    const plan = buildValidationPlan(registry, [], "full-health");
    expect(plan.checks.flatMap((check) => check.coveredChecks).sort()).toEqual(
      registry.checks.map((check) => check.id).sort(),
    );
    expect(
      plan.checks.some((check) => check.profile.includes("aggregate-coverage")),
    ).toBe(true);
  });
});

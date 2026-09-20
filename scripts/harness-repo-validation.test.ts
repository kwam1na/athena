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
  it("routes the harness operator guide through repository validation", () => {
    const files = { "docs/harness.md": "updated guide", "package.json": "{}" };
    const plan = buildValidationPlan(
      collectCanonicalValidationRegistry(Object.keys(files)),
      [{ path: "docs/harness.md", status: "modified" }],
      "comparison",
      { base: { ...files, "docs/harness.md": "old guide" }, candidate: files },
    );
    expect(
      plan.checks.some((check) =>
        check.argv.includes("bun run workflow:check"),
      ),
    ).toBe(true);
    expect(
      plan.checks.some((check) => check.argv.includes("bun run harness:test")),
    ).toBe(true);
  });

  it("retains guarded runtime readers and resolves their executable obligations", () => {
    const registry = collectCanonicalValidationRegistry([]);
    const docs = registry.impact?.relationships.find(
      (relationship) => relationship.id === "docs-publishing",
    );
    expect(docs?.kind).toBe("data");
    expect(
      docs?.lazyProducers?.[
        "packages/athena-webapp/vite-docs-content-plugin.ts"
      ],
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(docs?.publishingChecks?.length).toBeGreaterThan(0);
    for (const id of docs?.publishingChecks ?? []) {
      expect([
        "docs-publishing",
        "packages/athena-webapp:package-build",
      ]).toContain(registry.checks.find((check) => check.id === id)?.profile);
    }
    const styles = registry.impact?.relationships.find(
      (relationship) => relationship.id === "athena-webapp-style-data",
    );
    expect(
      styles?.guards?.["packages/athena-webapp/tailwind.config.js"],
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(
      styles?.boundedConsumers?.["packages/athena-webapp/src/index.css"],
    ).toMatch(/^[a-f0-9]{64}$/);
    const admission = registry.impact?.relationships.find(
      (relationship) => relationship.id === "convex-function-admission",
    );
    expect(admission?.checks).toHaveLength(1);
    expect(
      registry.checks.find((check) => check.id === admission?.checks?.[0])
        ?.argv,
    ).toEqual([
      "/bin/sh",
      "-c",
      "bun scripts/convex-operation-admission-check.ts",
    ]);
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
      ["package-build", "build:assets"],
    ]) {
      const check = fallbacks.find(
        (entry) => entry?.profile === `packages/athena-webapp:${profile}`,
      );
      expect(check?.cwd).toBe(
        profile === "fallback-suite" ? "." : "packages/athena-webapp",
      );
      expect(check?.argv).toEqual(
        profile === "fallback-suite"
          ? ["bun", "run", "--filter", "@athena/webapp", command]
          : ["bun", "run", command],
      );
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
      new Set([
        "plan-integrity",
        "docs-publishing",
        "packages/athena-webapp:package-types",
        "packages/athena-webapp:package-build",
      ]),
    );
    expect(
      plan.checks.some((check) => check.argv.includes("build:assets")),
    ).toBe(true);
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

describe("canonical build pipeline equivalence", () => {
  it("deduplicates authored, fallback and publishing type/build obligations", () => {
    const registry = collectCanonicalValidationRegistry([]);
    const plan = buildValidationPlan(registry, [], "full-health");
    for (const root of [
      "packages/athena-webapp",
      "packages/storefront-webapp",
    ]) {
      const types = plan.checks.filter(
        (check) => check.profile === `${root}:package-types`,
      );
      const assets = plan.checks.filter(
        (check) => check.profile === `${root}:package-build`,
      );
      expect(types).toHaveLength(1);
      expect(assets).toHaveLength(1);
      expect(types[0].cwd).toBe(root);
      expect(types[0].argv).toEqual(["bun", "run", "typecheck"]);
      expect(assets[0].argv).toEqual(["bun", "run", "build:assets"]);
      expect(assets[0].prerequisites).toEqual(types[0].coveredChecks);
      expect(types[0].inputs).toContain(`${root}/package.json`);
    }
    expect(plan.checks.some((check) => check.argv.at(-1) === "build")).toBe(
      false,
    );
  });
  it("selects one explicit typecheck prerequisite for report-only and mixed source/report plans", () => {
    const registry = collectCanonicalValidationRegistry([]);
    for (const paths of [
      ["docs/reports/report.html"],
      ["docs/reports/report.html", "packages/athena-webapp/src/main.tsx"],
    ]) {
      const plan = buildValidationPlan(
        registry,
        paths.map((path) => ({ path, status: "modified" as const })),
      );
      const types = plan.checks.filter(
        (check) => check.profile === "packages/athena-webapp:package-types",
      );
      const assets = plan.checks.filter(
        (check) => check.profile === "packages/athena-webapp:package-build",
      );
      expect(types).toHaveLength(1);
      expect(assets).toHaveLength(1);
      expect(assets[0].prerequisites).toEqual(types[0].coveredChecks);
    }
  });
});

it("normalizes exact root tsc scenarios into the shared package typecheck prerequisite", () => {
  const registry = collectCanonicalValidationRegistry([]);
  const plan = buildValidationPlan(registry, [], "full-health");
  expect(
    plan.checks.filter((check) =>
      check.argv.some((arg) =>
        arg.startsWith("bunx tsc --noEmit -p packages/"),
      ),
    ),
  ).toEqual([]);
  for (const app of ["athena-webapp", "storefront-webapp"]) {
    const root = `packages/${app}`;
    const types = registry.checks.filter(
      (check) => check.profile === `${root}:package-types`,
    );
    expect(types).toHaveLength(1);
    expect(types[0].inputs).toContain(`${root}/tsconfig.json`);
    expect(
      registry.surfaces.filter((surface) =>
        surface.checks.includes(types[0].id),
      ).length,
    ).toBeGreaterThan(1);
    expect(
      registry.checks.find((check) => check.profile === `${root}:package-build`)
        ?.prerequisites,
    ).toEqual([types[0].id]);
  }
});


it("selects source artifact integrity rather than host-journal admission", async () => {
  const { collectCanonicalValidationRegistry } = await import("./harness-repo-validation");
  const { buildValidationPlan } = await import("./harness-validation-plan");
  const registry = collectCanonicalValidationRegistry([]);
  const surface = registry.surfaces.find((row) => row.id === "delivery-records")!;
  const plan = buildValidationPlan(registry, [], "full-health");
  const check = plan.checks.find((row) => row.coveredChecks.some((id) => surface.checks.includes(id)))!;
  expect(check.argv.join(" ")).toContain("bun scripts/delivery-telemetry-artifacts.ts --base refs/delivery/base");
  expect(plan.checks.some((row) => row.argv.join(" ").includes("delivery:telemetry-check"))).toBe(false);
});

describe("operator full-unit contract", () => {
  it("pins the complete config loading sources and package membership pattern", async () => {
    const { OPERATOR_FULL_UNIT_CONTRACT: contract } =
      await import("./harness-repo-validation");
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    for (const [path, digest] of Object.entries(contract.sources))
      expect(
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      ).toBe(digest);
    expect(
      new Bun.Glob(contract.testPattern).match(
        `${contract.root}/convex/new.test.ts`,
      ),
    ).toBe(true);
    expect(
      new Bun.Glob(contract.testPattern).match(
        `${contract.root}/src/new.spec.ts`,
      ),
    ).toBe(false);
  });
});

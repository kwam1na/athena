import { describe, expect, it } from "vitest";

import { HARNESS_APP_REGISTRY } from "./harness-app-registry";

describe("HARNESS_APP_REGISTRY", () => {
  it("keeps the valkey proxy service registered as a service-package archetype", () => {
    const valkeyProxy = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "valkey-proxy-server"
    );

    expect(valkeyProxy?.appName).toBe("valkey-proxy-server");
    expect(valkeyProxy?.archetype).toBe("service-package");
    expect(valkeyProxy?.onboardingStatus).toBe("active");
    expect(valkeyProxy?.packageDir).toBe("packages/valkey-proxy-server");
    expect(valkeyProxy?.auditedRoots).toEqual(["."]);
    expect(valkeyProxy?.harnessDocs.entryIndexPath).toBe(
      "packages/valkey-proxy-server/docs/agent/entry-index.md"
    );
    expect(valkeyProxy?.harnessDocs.requiredIndexLinks).toContain(
      "./entry-index.md"
    );
    expect(valkeyProxy?.harnessDocs.requiredCodeMapLinks).toContain(
      "./entry-index.md"
    );
  });

  it("maps package metadata and service entry files into the valkey validation surface", () => {
    const valkeyProxy = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "valkey-proxy-server"
    );
    const serviceScenario = valkeyProxy?.validationScenarios.find(
      (scenario) => scenario.title === "Service logic, docs, or entrypoint edits"
    );
    const liveProbeScenario = valkeyProxy?.validationScenarios.find(
      (scenario) => scenario.title === "Live connection probe edits"
    );

    expect(serviceScenario).toMatchObject({
      touchedPaths: [
        "package.json",
        "README.md",
        "app.js",
        "app.test.js",
        "index.js",
      ],
      commands: [
        { kind: "script", script: "test" },
        {
          kind: "raw",
          command: "node --check packages/valkey-proxy-server/app.js",
        },
        {
          kind: "raw",
          command: "node --check packages/valkey-proxy-server/index.js",
        },
      ],
    });
    expect(serviceScenario?.behaviorScenarios).toEqual([
      "valkey-proxy-local-request-response",
    ]);
    expect(liveProbeScenario).toMatchObject({
      touchedPaths: ["test-connection.js"],
      commands: [
        { kind: "script", script: "test" },
        {
          kind: "raw",
          command: "node --check packages/valkey-proxy-server/test-connection.js",
        },
      ],
    });
  });

  it("keeps storefront full-browser validation scoped to routes and playwright specs", () => {
    const storefront = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "storefront-webapp"
    );
    const fullBrowserScenario = storefront?.validationScenarios.find(
      (scenario) => scenario.title === "Full browser journeys and payment redirects"
    );

    expect(fullBrowserScenario).toMatchObject({
      touchedPaths: ["tests/e2e", "src/routes/shop/checkout"],
      commands: [
        { kind: "script", script: "test" },
        { kind: "script", script: "test:e2e" },
      ],
      behaviorScenarios: [
        "storefront-checkout-bootstrap",
        "storefront-checkout-validation-blocker",
        "storefront-checkout-verification-recovery",
      ],
    });
  });

  it("covers storefront runtime and build-pipeline edits with a typecheck scenario", () => {
    const storefront = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "storefront-webapp"
    );
    const runtimeScenario = storefront?.validationScenarios.find(
      (scenario) => scenario.title === "Route runtime or build-pipeline edits"
    );

    expect(runtimeScenario).toMatchObject({
      touchedPaths: [
        "index.html",
        "package.json",
        "tsconfig.json",
        "src/main.tsx",
        "src/router.tsx",
        "src/routeTree.gen.ts",
        "vite.config.ts",
      ],
      commands: [
        { kind: "script", script: "test" },
        { kind: "script", script: "build" },
        {
          kind: "raw",
          command:
            "bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json",
        },
      ],
    });
  });

  it("covers Athena convex validation scripts in the backend-adjacent scenario", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const backendScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Convex or backend-adjacent edits"
    );

    expect(backendScenario).toMatchObject({
      touchedPaths: [
        "convex",
        "scripts/convex-audit.sh",
        "scripts/convex-lint-changed.sh",
        "src/routes/_authed",
        "src/main.tsx",
      ],
      commands: [
        { kind: "script", script: "test" },
        { kind: "script", script: "audit:convex" },
        { kind: "script", script: "lint:convex:changed" },
      ],
      note:
        "Any change that can affect Convex HTTP wiring, serviceOps schemas and workflows, shared operational rails, or route-to-backend composition should include the Convex audit pair.",
      behaviorScenarios: [
        "athena-convex-storefront-composition",
        "athena-convex-storefront-failure-visibility",
      ],
    });
  });

  it("documents Athena service management as a first-class harness discovery surface", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const backendFolders = athena?.keyFolderGroups.find(
      (group) => group.title === "Backend and test surfaces"
    )?.folders;
    const routeScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Route or UI-only edits"
    );

    expect(backendFolders).toContainEqual({
      path: "convex/serviceOps",
      description:
        "Service catalog, appointment, and service-case workflows layered on operational work items.",
    });
    expect(routeScenario?.note).toBe(
      "Use this for authenticated dashboard flows, service-management screens, route trees, and UI behavior changes that stay inside the frontend shell."
    );
  });

  it("covers Athena shared type exports in the shared-lib validation scenario", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const sharedLibScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Shared-lib or utility edits"
    );

    expect(sharedLibScenario).toMatchObject({
      touchedPaths: [
        "src/lib",
        "src/settings",
        "src/utils",
        "src/stores",
        "types.ts",
      ],
      commands: [
        { kind: "script", script: "test" },
        {
          kind: "raw",
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
      ],
    });
  });

  it("covers Athena Storybook and frontend tooling edits with isolated validation", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const storybookScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Storybook and frontend tooling edits"
    );

    expect(storybookScenario).toMatchObject({
      touchedPaths: [
        ".storybook",
        "src/stories",
        "src/index.css",
        "tailwind.config.js",
        "package.json",
        "eslint.config.js",
        ".gitignore",
      ],
      commands: [
        { kind: "script", script: "test" },
        { kind: "script", script: "build" },
        { kind: "script", script: "storybook:build" },
      ],
      note:
        "Use this when Storybook config, story files, or package-level frontend tooling changes need isolated validation.",
    });
  });

  it("keeps every registered app active once onboarding is complete", () => {
    const statuses = HARNESS_APP_REGISTRY.map((entry) => entry.onboardingStatus);

    expect(statuses).toEqual(["active", "active", "active"]);
  });
});

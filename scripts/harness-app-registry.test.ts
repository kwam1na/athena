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

  it("keeps every registered app active once onboarding is complete", () => {
    const statuses = HARNESS_APP_REGISTRY.map((entry) => entry.onboardingStatus);

    expect(statuses).toEqual(["active", "active", "active"]);
  });
});

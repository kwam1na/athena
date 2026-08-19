import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { healthRouteReadDefinition } from "../operationAdmission/domains/httpCore_readDefinitions";
import { validateReadOperationDefinition } from "../operationAdmission/readDefinitions";

const projectRoot = process.cwd();

describe("http health route", () => {
  it("registers a shallow unauthenticated health endpoint", () => {
    const httpRouter = readFileSync(join(projectRoot, "convex", "http.ts"), "utf8");

    expect(httpRouter).toContain('app.get(\n  "/health",');
    expect(httpRouter).toContain('app: "athena-webapp-backend"');
    expect(httpRouter).toContain('status: "ok"');
  });

  it("declares the probe as an anonymous read that reaches no store data", () => {
    expect(validateReadOperationDefinition(healthRouteReadDefinition)).toEqual(
      [],
    );
    expect(healthRouteReadDefinition).toMatchObject({
      kind: "http_read",
      route: { method: "GET", path: "/health" },
      access: { intent: "platform.health.view" },
      scope: { kind: "none" },
      actors: { public: "admit", sharedDemo: "deny", storefrontCustomer: "deny" },
    });
  });
});

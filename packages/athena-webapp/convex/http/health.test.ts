import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();

describe("http health route", () => {
  it("registers a shallow unauthenticated health endpoint", () => {
    const httpRouter = readFileSync(join(projectRoot, "convex", "http.ts"), "utf8");

    expect(httpRouter).toContain('app.get("/health", (c) => {');
    expect(httpRouter).toContain('app: "athena-webapp-backend"');
    expect(httpRouter).toContain('status: "ok"');
  });
});

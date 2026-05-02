import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const FIXTURE_PATH = "scripts/harness-behavior-fixtures/storefront-runtime-api.ts";

describe("storefront-runtime-api fixture", () => {
  it("supports the backend first-load mode and fixture routes used by the browser sensor", async () => {
    const source = await readFile(FIXTURE_PATH, "utf8");

    expect(source).toContain('"backend-first-load"');
    expect(source).toContain('emitSignal("storefront-backend-first-load")');
    expect(source).toContain('pathname === "/bestSellers"');
    expect(source).toContain('pathname === "/featured"');
    expect(source).toContain("withCorsHeaders");
  });
});

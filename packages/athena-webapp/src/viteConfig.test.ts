import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Vite dependency optimization", () => {
  it("scans only the application entry", () => {
    const configSource = readFileSync(
      resolve(process.cwd(), "vite.config.ts"),
      "utf8"
    );

    expect(configSource).toMatch(
      /optimizeDeps:\s*\{[\s\S]*?entries:\s*\["index\.html"\]/
    );
  });
});

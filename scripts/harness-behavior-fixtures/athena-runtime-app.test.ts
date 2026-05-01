import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Athena runtime behavior fixture", () => {
  it("mounts the customer-channel storefront HTTP routes", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts/harness-behavior-fixtures/athena-runtime-app.ts"),
      "utf8"
    );

    expect(source).toContain(
      "../../packages/athena-webapp/convex/http/domains/customerChannel/routes/storefront"
    );
  });
});

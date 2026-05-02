import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const readRouteFile = (fileName: string) =>
  readFileSync(
    join(
      projectRoot,
      "convex",
      "http",
      "domains",
      "customerChannel",
      "routes",
      fileName,
    ),
    "utf8",
  );

describe("storefront customer channel CORS", () => {
  it("lets the shared HTTP CORS middleware reflect storefront QA origins", () => {
    expect(readRouteFile("storefront.ts")).not.toContain(
      'Access-Control-Allow-Origin", "https://wigclub.store"',
    );
    expect(readRouteFile("guest.ts")).not.toContain(
      'Access-Control-Allow-Origin", "https://wigclub.store"',
    );
  });
});

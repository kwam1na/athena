import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("MTN collections foundation", () => {
  it("adds the transaction and token tables needed for store-scoped MTN state", () => {
    const schemaSource = readProjectFile("convex", "schema.ts").replace(
      /\s+/g,
      " ",
    );

    expect(schemaSource).toContain(
      'mtnCollectionsToken: defineTable(mtnCollectionsTokenSchema).index("by_storeId", ["storeId"])',
    );
    expect(schemaSource).toContain(
      'mtnCollectionTransaction: defineTable(mtnCollectionTransactionSchema)',
    );
    expect(schemaSource).toContain(
      '.index("by_providerReference", ["providerReference"])',
    );
    expect(schemaSource).toContain(
      '.index("by_storeId_requestedAt", ["storeId", "requestedAt"])',
    );
  });

  it("registers the MTN webhook route on the shared Hono router", () => {
    const httpRouter = readProjectFile("convex", "http.ts");

    expect(httpRouter).toContain('app.route("/webhooks/mtn-momo", mtnMomoRoutes);');
  });
});

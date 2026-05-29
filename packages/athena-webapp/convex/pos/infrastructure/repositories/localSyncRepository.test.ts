import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("createConvexLocalSyncRepository", () => {
  it("does not use paginated reads while syncing service-case financials", () => {
    const source = readProjectFile(
      "convex",
      "pos",
      "infrastructure",
      "repositories",
      "localSyncRepository.ts",
    );
    const financialSyncSource = source.slice(
      source.indexOf("async syncServiceCaseFinancials(serviceCaseId)"),
      source.indexOf("async createTransaction(input)"),
    );

    expect(financialSyncSource).toContain(".collect()");
    expect(financialSyncSource).not.toContain(".paginate(");
  });
});

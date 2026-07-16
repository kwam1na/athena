import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const INDEXED_DB_REFERENCE =
  /\b(?:indexedDB|IDB(?:Database|Factory|KeyRange|ObjectStore|OpenDBRequest|Request|Transaction))\b/;
const ENGINE_IMPLEMENTATIONS = [
  "lib/pos/infrastructure/local/posLocalStore.ts",
];
const CONCRETE_STORE_IMPORT =
  /from\s+["'](?:\.\/|@\/lib\/pos\/infrastructure\/local\/)posLocalStore["']/;
const ENGINE_COMPOSITION =
  "lib/pos/infrastructure/local/indexedDbPosLocalStorageEngine.ts";

describe("POS local storage engine boundary", () => {
  it("keeps IndexedDB mechanics inside the selected engine implementation", () => {
    const sourceRoot = join(process.cwd(), "src");
    const offenders = collectProductionSources(sourceRoot)
      .filter((filePath) =>
        INDEXED_DB_REFERENCE.test(readFileSync(filePath, "utf8")),
      )
      .map((filePath) => relative(sourceRoot, filePath));

    expect(offenders).toEqual(ENGINE_IMPLEMENTATIONS);
  });

  it("keeps production consumers on application-owned semantic contracts", () => {
    const sourceRoot = join(process.cwd(), "src");
    const offenders = collectProductionSources(sourceRoot)
      .filter((filePath) =>
        CONCRETE_STORE_IMPORT.test(readFileSync(filePath, "utf8")),
      )
      .map((filePath) => relative(sourceRoot, filePath));

    expect(offenders).toEqual([ENGINE_COMPOSITION]);
  });
});

function collectProductionSources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const nextPath = join(directory, entry);
    const stats = statSync(nextPath);
    if (stats.isDirectory()) return collectProductionSources(nextPath);
    const extension = extname(nextPath);
    const isSource = extension === ".ts" || extension === ".tsx";
    const isTest = /\.(?:test|spec)\.tsx?$/.test(nextPath);
    return isSource && !isTest ? [nextPath] : [];
  });
}

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { generateGraphifyWikiPages, GRAPHIFY_WIKI_ARTIFACTS } from "./graphify-wiki";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-graphify-wiki-"));
  tempRoots.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("generateGraphifyWikiPages", () => {
  it("builds a root index and package landing pages from graph and harness metadata", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      "graphify-out/graph.json",
      JSON.stringify(
        {
          directed: false,
          multigraph: false,
          graph: {},
          nodes: [
            {
              label: "sharedHotspot()",
              file_type: "code",
              source_file: "packages/athena-webapp/src/lib/shared.ts",
              source_location: "L1",
              id: "shared_hotspot",
              community: 11,
            },
            {
              label: "storeHotspot()",
              file_type: "code",
              source_file: "packages/storefront-webapp/src/lib/store.ts",
              source_location: "L1",
              id: "store_hotspot",
              community: 22,
            },
            {
              label: "supportingFile.ts",
              file_type: "code",
              source_file: "scripts/supporting-file.ts",
              source_location: "L1",
              id: "supporting_file",
              community: 33,
            },
          ],
          links: [
            {
              relation: "calls",
              confidence: "EXTRACTED",
              source_file: "packages/athena-webapp/src/lib/shared.ts",
              source_location: "L1",
              weight: 1,
              _src: "shared_hotspot",
              _tgt: "store_hotspot",
              source: "shared_hotspot",
              target: "store_hotspot",
              confidence_score: 1,
            },
          ],
          hyperedges: [],
        },
        null,
        2
      ),
      rootDir
    );

    const pages = await generateGraphifyWikiPages(rootDir);

    expect(Array.from(pages.keys())).toEqual(GRAPHIFY_WIKI_ARTIFACTS);
    expect(pages.get("graphify-out/wiki/index.md")).toContain("# Graphify Wiki");
    expect(pages.get("graphify-out/wiki/index.md")).toContain("Repo Summary");
    expect(pages.get("graphify-out/wiki/index.md")).toContain("sharedHotspot()");
    expect(pages.get("graphify-out/wiki/index.md")).toContain(
      "packages/athena-webapp"
    );
    expect(
      pages.get("graphify-out/wiki/packages/athena-webapp.md")
    ).toContain("AGENTS.md");
    expect(
      pages.get("graphify-out/wiki/packages/athena-webapp.md")
    ).toContain("docs/agent/testing.md");
    expect(
      pages.get("graphify-out/wiki/packages/storefront-webapp.md")
    ).toContain("storeHotspot()");
    expect(
      pages.get("graphify-out/wiki/packages/storefront-webapp.md")
    ).toContain("docs/agent/code-map.md");
  });
});

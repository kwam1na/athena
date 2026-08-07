import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertDocsLinks,
  collectDocsLinkFindings,
} from "./docs-solution-link-check";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Builds a miniature docs/ tree: { "category/file.md": body }. */
async function fixture(docs: Record<string, string>, extraFiles: string[] = []) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-docs-links-"));
  created.push(rootDir);

  for (const [relative, body] of Object.entries(docs)) {
    const full = path.join(rootDir, "docs", "solutions", relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  for (const relative of extraFiles) {
    const full = path.join(rootDir, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, "# Elsewhere\n", "utf8");
  }
  return rootDir;
}

describe("docs cross-reference sensor", () => {
  it("passes when every reference resolves to a real doc", async () => {
    const rootDir = await fixture({
      "architecture/alpha.md": "## Related\n\n- [Beta](../logic-errors/beta.md)\n- [Gamma](gamma.md)\n",
      "architecture/gamma.md": "# Gamma\n",
      "logic-errors/beta.md": "# Beta\n",
    });

    const { docCount, counts } = assertDocsLinks(rootDir);
    expect(docCount).toBe(3);
    expect(counts.routed).toBe(2);
  });

  it("fails a reference filed under the wrong category", async () => {
    // The exact shape that shipped: the note lives under architecture-patterns
    // but is cited under architecture.
    const rootDir = await fixture({
      "architecture/alpha.md": "## Related\n\n- [Open work](../architecture/open-work.md)\n",
      "architecture-patterns/open-work.md": "# Open work\n",
    });

    expect(() => assertDocsLinks(rootDir)).toThrow(
      /resolves to architecture\/open-work, which does not exist/,
    );
  });

  it("fails a reference that climbs out of docs/solutions entirely", async () => {
    // One ../ too many: docs/architecture/… instead of docs/solutions/architecture/….
    const rootDir = await fixture({
      "architecture-patterns/alpha.md": "- [Beta](../../architecture/beta.md)\n",
      "architecture/beta.md": "# Beta\n",
    });

    expect(() => assertDocsLinks(rootDir)).toThrow(
      /points at docs\/architecture\/beta\.md, which is not a file in this repo/,
    );
  });

  it("allows an accurate pointer at a repo file the viewer cannot route", async () => {
    const rootDir = await fixture(
      { "developer-experience/alpha.md": "- [Harness](../../harness.md)\n" },
      ["docs/harness.md"],
    );

    const { counts } = assertDocsLinks(rootDir);
    expect(counts["plain-text"]).toBe(1);
    expect(counts.dangling).toBe(0);
  });

  it("ignores external and in-page links", async () => {
    const rootDir = await fixture({
      "architecture/alpha.md":
        "- [Issue](https://linear.app/v26-labs/issue/V26-1)\n- [Jump](#problem)\n\n## Problem\n",
    });

    const { counts } = assertDocsLinks(rootDir);
    expect(counts).toMatchObject({ external: 1, anchor: 1, broken: 0, dangling: 0 });
  });

  it("reports the line a broken reference sits on", async () => {
    const rootDir = await fixture({
      "architecture/alpha.md": "# Alpha\n\n## Related\n\n- [Missing](missing.md)\n",
    });

    const { findings } = collectDocsLinkFindings(rootDir);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      docPath: path.join("docs", "solutions", "architecture", "alpha.md"),
      line: 5,
    });
  });
});

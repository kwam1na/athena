import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const createdDirs: string[] = [];
const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "../scripts/convexPaginationAntiPatternCheck.py");

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), "athena-convex-pagination-check-"));
  const convexDir = join(root, "convex");
  mkdirSync(convexDir, { recursive: true });
  createdDirs.push(root);
  return { root, convexDir };
}

function writeConvexFile(convexDir: string, fileName: string, content: string) {
  const filePath = join(convexDir, fileName);
  writeFileSync(filePath, content);
  return filePath;
}

function runPaginationCheck(rootDir: string, args: string[] = []) {
  return spawnSync("python3", [scriptPath, rootDir, ...args], {
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup should never fail tests.
    }
  }
});

describe("convex pagination anti-pattern check", () => {
  it("passes when each function has at most one paginate call", () => {
    const { root, convexDir } = createTempRoot();

    writeConvexFile(
      convexDir,
      "clean.ts",
      `
export const getSessionItems = query({
  args: {},
  handler: async () => {
    const page = await ctx.db
      .query("posSessionItem")
      .paginate({ cursor: null, numItems: 10 });
    return page;
  },
});
`,
    );

    const result = runPaginationCheck(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Convex pagination anti-pattern check passed",
    );
  });

  it("fails when a function contains multiple paginate calls", () => {
    const { root, convexDir } = createTempRoot();
    writeConvexFile(
      convexDir,
      "bad.ts",
      `
export const cleanupSessions = mutation({
  args: {},
  handler: async () => {
    const sessions = await ctx.db
      .query("posSession")
      .paginate({ cursor: null, numItems: 10 });
    const items = await ctx.db
      .query("posSessionItem")
      .paginate({ cursor: null, numItems: 10 });
    return sessions.page ?? items.page;
  },
});
`,
    );

    const result = runPaginationCheck(root, ["convex/bad.ts"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("has 2 paginate calls");
    expect(result.stdout).toContain("bad.ts");
  });
});

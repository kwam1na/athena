import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const CONVEX_BROWSER_WARNING =
  "Convex functions should not be imported in the browser";
const TEST_FILE_SUFFIX = ".test.ts";
const TEST_TSX_FILE_SUFFIX = ".test.tsx";

const ALLOWED_CONVEX_IMPORT_PATTERNS = [
  /(?:^|\/)convex\/_generated\//,
  /(?:^|\/)convex\/lib\/currency$/,
  /(?:^|\/)convex\/utils$/,
  /(?:^|\/)convex\/inventory\/utils$/,
  /(?:^|\/)convex\/emails\//,
];

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const nextPath = join(directory, entry);
    const stats = statSync(nextPath);

    if (stats.isDirectory()) {
      return collectSourceFiles(nextPath);
    }

    const extension = extname(nextPath);
    const isSourceFile = extension === ".ts" || extension === ".tsx";
    const isTestFile =
      nextPath.endsWith(TEST_FILE_SUFFIX) || nextPath.endsWith(TEST_TSX_FILE_SUFFIX);

    return isSourceFile && !isTestFile ? [nextPath] : [];
  });
}

function findIllegalConvexImports(sourceRoot: string) {
  const importPattern = /from\s+["']([^"']+)["']/g;

  return collectSourceFiles(sourceRoot).flatMap((filePath) => {
    const contents = readFileSync(filePath, "utf8");
    const imports = Array.from(contents.matchAll(importPattern), ([, specifier]) =>
      specifier,
    );

    const illegalImports = imports.filter((specifier) => {
      const isProjectConvexImport =
        specifier.startsWith("~/convex/") ||
        (specifier.startsWith(".") && specifier.includes("convex/"));

      if (!isProjectConvexImport) {
        return false;
      }

      return !ALLOWED_CONVEX_IMPORT_PATTERNS.some((pattern) =>
        pattern.test(specifier),
      );
    });

    return illegalImports.map((specifier) => ({
      file: relative(sourceRoot, filePath),
      specifier,
    }));
  });
}

describe("Athena route tree browser boundary", () => {
  it("keeps client source from importing raw Convex server modules", () => {
    const sourceRoot = dirname(fileURLToPath(import.meta.url));

    expect(findIllegalConvexImports(sourceRoot)).toEqual([]);
  });

  it("reports the file and specifier for a raw Convex server import", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "athena-browser-boundary-"));

    try {
      mkdirSync(join(sourceRoot, "features"), { recursive: true });
      writeFileSync(
        join(sourceRoot, "features", "safe.ts"),
        'import { api } from "~/convex/_generated/api";\n'
      );
      writeFileSync(
        join(sourceRoot, "features", "unsafe.tsx"),
        'import { validateServiceIntakeInput } from "~/convex/operations/serviceIntake";\n'
      );

      expect(findIllegalConvexImports(sourceRoot)).toEqual([
        {
          file: "features/unsafe.tsx",
          specifier: "~/convex/operations/serviceIntake",
        },
      ]);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it(
    "does not import Convex server modules when the browser route tree loads",
    async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await import("./routeTree.gen");

        const convexWarnings = warnSpy.mock.calls.filter(([message]) =>
          String(message).includes(CONVEX_BROWSER_WARNING),
        );

        expect(convexWarnings).toHaveLength(0);
      } finally {
        warnSpy.mockRestore();
      }
    },
    15000
  );
});

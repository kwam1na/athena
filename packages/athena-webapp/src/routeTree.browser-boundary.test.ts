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
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const CONVEX_BROWSER_WARNING =
  "Convex functions should not be imported in the browser";
const TEST_FILE_SUFFIX = ".test.ts";
const TEST_TSX_FILE_SUFFIX = ".test.tsx";

// Every package directory the Vite browser bundle pulls first-party modules
// from. `src/` is the app itself. `shared/` holds the modules that were moved
// out of `convex/` precisely so the browser could import them (currency, order
// math, schedule math, notification policy, geography, archive policy, ...) —
// it is reached from `src/` through the `~` alias and ends up in the bundle
// exactly like `src/` does. Scanning only `src/` left `shared/` free to import
// Convex internals straight into the browser without this sensor noticing.
//
// Root `types.ts` re-exports `@athena/contracts`, which owns its own single,
// documented, type-only Convex seam (`packages/athena-contracts/convexModel.ts`)
// and is guarded by the architecture boundary lint; it is deliberately not part
// of this package-local scan.
const BROWSER_SOURCE_DIRECTORIES = ["src", "shared"] as const;

// The generated client is the ONLY Convex module the browser bundle may
// import. Everything else that the browser and the server genuinely share —
// currency conversion, order math, schedule math, notification policy — lives
// in `shared/`, and presentation that only the browser renders lives under
// `src/`. Do not add an exception here: move the code instead.
const ALLOWED_CONVEX_IMPORT_PATTERNS = [/(?:^|\/)convex\/_generated\//];

// Type-only imports erase at build, so they add no runtime edge — and they are
// still reported here on purpose. `import type` is one keyword away from a
// value import, that keyword is invisible in review, and the point of the
// browser boundary is that browser-reachable code has no line of sight into
// Convex internals at all. The generated model stays allowed either way, which
// is the only Convex type surface browser code has ever needed.
const IMPORT_SPECIFIER_PATTERNS = [
  // `import ... from "x"` and `export ... from "x"` (including `import type`).
  /from\s+["']([^"']+)["']/g,
  // `import("x")` — a dynamic import is a real runtime edge into the bundle.
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  // `import "x"` — side-effect import, no bindings, still pulls the module in.
  /(?:^|[;{}\n])\s*import\s+["']([^"']+)["']/g,
];

/**
 * Normalize a first-party Convex specifier to a `convex/...` path, or return
 * null when the specifier does not reach into this package's Convex directory.
 *
 * `@cvx/*` is a real alias for `./convex/*` in both `vite.config.ts` and
 * `tsconfig.json`, so it has to be normalized here; matching only `~/convex/`
 * would let `@cvx/operations/...` walk straight past the boundary.
 *
 * A relative specifier is RESOLVED against the importing file rather than
 * substring-matched. `src/lib/pos/infrastructure/convex/` is a real directory
 * inside the browser source tree, so `./convex/gateway` written next to it
 * contains `convex/` while never leaving `src/` — a substring test reports
 * that as a boundary crossing. Only a relative import that escapes the
 * browser source root it was found in and lands in a `convex` directory has
 * actually crossed anything.
 */
function toProjectConvexPath(
  specifier: string,
  context: { filePath: string; reportRoot: string; sourceRoot: string },
): string | null {
  if (specifier.startsWith("~/convex/")) {
    return specifier.slice("~/".length);
  }

  if (specifier.startsWith("@cvx/")) {
    return `convex/${specifier.slice("@cvx/".length)}`;
  }

  if (specifier.startsWith(".")) {
    const resolved = resolve(dirname(context.filePath), specifier);
    const withinSourceRoot = relative(context.sourceRoot, resolved);

    if (withinSourceRoot !== "" && !withinSourceRoot.startsWith("..")) {
      // Still inside `src/` (or `shared/`). Whatever it is named, it is a
      // browser module, not a Convex one.
      return null;
    }

    const fromPackage = relative(context.reportRoot, resolved);

    return fromPackage.split(sep).includes("convex") ? fromPackage : null;
  }

  return null;
}

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

function findIllegalConvexImports(sourceRoot: string, reportRoot = sourceRoot) {
  return collectSourceFiles(sourceRoot).flatMap((filePath) => {
    const contents = readFileSync(filePath, "utf8");
    const imports = IMPORT_SPECIFIER_PATTERNS.flatMap((pattern) =>
      Array.from(contents.matchAll(pattern), ([, specifier]) => specifier),
    );

    const illegalImports = imports.filter((specifier) => {
      const convexPath = toProjectConvexPath(specifier, {
        filePath,
        reportRoot,
        sourceRoot,
      });

      if (convexPath === null) {
        return false;
      }

      return !ALLOWED_CONVEX_IMPORT_PATTERNS.some((pattern) =>
        pattern.test(convexPath),
      );
    });

    return illegalImports.map((specifier) => ({
      file: relative(reportRoot, filePath),
      specifier,
    }));
  });
}

function browserSourceRoots() {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

  return {
    packageRoot,
    directories: BROWSER_SOURCE_DIRECTORIES.map((directory) => ({
      directory,
      absolutePath: join(packageRoot, directory),
    })),
  };
}

describe("Athena route tree browser boundary", () => {
  it("scans every browser-reachable source directory", () => {
    // Guards the failure mode this sensor is most exposed to: a directory
    // rename or move that leaves the scan pointed at nothing, so the boundary
    // silently stops being enforced while the suite stays green.
    const { directories } = browserSourceRoots();

    const scanned = directories.map(({ directory, absolutePath }) => ({
      directory,
      fileCount: collectSourceFiles(absolutePath).length,
    }));

    expect(scanned.every(({ fileCount }) => fileCount > 0)).toBe(true);
  });

  it("keeps browser-reachable source from importing raw Convex server modules", () => {
    const { packageRoot, directories } = browserSourceRoots();

    const violations = directories.flatMap(({ absolutePath }) =>
      findIllegalConvexImports(absolutePath, packageRoot),
    );

    expect(violations).toEqual([]);
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

  it("catches Convex server imports that dodge the plain `import ... from` form", () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "athena-browser-boundary-"));

    try {
      writeFileSync(
        join(sourceRoot, "aliased.ts"),
        'import { validateServiceIntakeInput } from "@cvx/operations/serviceIntake";\n'
      );
      writeFileSync(
        join(sourceRoot, "aliasedGenerated.ts"),
        'import { api } from "@cvx/_generated/api";\n'
      );
      writeFileSync(
        join(sourceRoot, "dynamic.ts"),
        'export const load = () => import("~/convex/inventoryLedger/post");\n'
      );
      writeFileSync(
        join(sourceRoot, "sideEffect.ts"),
        'import "../convex/operations/serviceIntake";\n'
      );
      writeFileSync(
        join(sourceRoot, "typeOnly.ts"),
        'import type { addressSchema } from "~/convex/schemas/storeFront";\n'
      );
      writeFileSync(
        join(sourceRoot, "reExport.ts"),
        'export { foldDay } from "~/convex/reports/foldDay";\n'
      );

      const violations = findIllegalConvexImports(sourceRoot).map(
        ({ specifier }) => specifier,
      );

      expect(violations.sort()).toEqual([
        "../convex/operations/serviceIntake",
        "@cvx/operations/serviceIntake",
        "~/convex/inventoryLedger/post",
        "~/convex/reports/foldDay",
        "~/convex/schemas/storeFront",
      ]);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("does not flag a relative import into a `convex/` directory that stays inside the source root", () => {
    // `src/lib/pos/infrastructure/convex/` is a real directory in this package.
    // A sibling importing `./convex/...` never leaves `src/`, so it is not a
    // boundary crossing — but it does contain the substring `convex/`, which is
    // all the previous check looked at. The genuine escape written from the
    // same directory must still be reported, so the two are planted together.
    const sourceRoot = mkdtempSync(join(tmpdir(), "athena-browser-boundary-"));
    const infrastructure = join(sourceRoot, "lib", "pos", "infrastructure");

    try {
      mkdirSync(join(infrastructure, "convex"), { recursive: true });
      writeFileSync(
        join(infrastructure, "convex", "gateway.ts"),
        "export const gateway = () => null;\n",
      );
      writeFileSync(
        join(infrastructure, "useGateway.ts"),
        'import { gateway } from "./convex/gateway";\n',
      );
      writeFileSync(
        join(infrastructure, "leak.ts"),
        'import { post } from "../../../../convex/inventoryLedger/post";\n',
      );

      expect(findIllegalConvexImports(sourceRoot)).toEqual([
        {
          file: "lib/pos/infrastructure/leak.ts",
          specifier: "../../../../convex/inventoryLedger/post",
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
    30000
  );
});

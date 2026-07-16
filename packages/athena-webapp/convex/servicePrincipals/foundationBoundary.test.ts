import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type FoundationRoot = {
  label: string;
  path: string;
};

type BoundaryViolation = {
  file: string;
  reason: string;
};

const convexRoot = resolve(process.cwd(), "convex");
const foundationRoots: FoundationRoot[] = [
  {
    label: "service-principal modules",
    path: resolve(convexRoot, "servicePrincipals"),
  },
  {
    label: "service-principal schemas",
    path: resolve(convexRoot, "schemas/servicePrincipals"),
  },
];

const consumerSpecificIdentifiers =
  /\b(?:POS|(?:pos|Pos)(?:Application|Terminal|Recovery)\w*|pointOfSale\w*|terminal\w*|recoveryCode\w*|recoveryCredential\w*|cashier\w*|drawer\w*)\b/g;
const posCapabilityLiteral = /["'`]pos(?:[._-][a-z0-9._-]+)?["'`]/gi;
const posModuleSegment = /^(?:pos|Pos|POS)(?:$|[A-Z_-])/;

function isProductionTypeScriptFile(fileName: string) {
  return (
    fileName.endsWith(".ts") &&
    !fileName.endsWith(".test.ts") &&
    !fileName.endsWith(".testSupport.ts")
  );
}

function productionFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "testSupport" ? [] : productionFiles(path);
    }
    return isProductionTypeScriptFile(entry.name) ? [path] : [];
  });
}

function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function importSpecifiers(source: string) {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*(?:\(\s*)?["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ];

  return [
    ...new Set(
      patterns.flatMap((pattern) =>
        Array.from(source.matchAll(pattern), (match) => match[1]),
      ),
    ),
  ];
}

function isPosModuleSpecifier(specifier: string) {
  return specifier
    .split("/")
    .some((segment) => posModuleSegment.test(segment));
}

function relativeToConvex(path: string) {
  return relative(convexRoot, path);
}

function inspectFoundationSource(
  displayPath: string,
  unprocessedSource: string,
): BoundaryViolation[] {
  const source = withoutComments(unprocessedSource);
  const violations: BoundaryViolation[] = [];

  if (posModuleSegment.test(basename(displayPath, ".ts"))) {
    violations.push({
      file: displayPath,
      reason: "consumer-specific filename",
    });
  }

  for (const specifier of importSpecifiers(source)) {
    if (isPosModuleSpecifier(specifier)) {
      violations.push({
        file: displayPath,
        reason: `imports POS module ${JSON.stringify(specifier)}`,
      });
    }
  }

  for (const match of source.matchAll(posCapabilityLiteral)) {
    violations.push({
      file: displayPath,
      reason: `declares consumer capability ${match[0]}`,
    });
  }

  for (const match of source.matchAll(consumerSpecificIdentifiers)) {
    violations.push({
      file: displayPath,
      reason: `uses consumer-specific identifier ${match[0]}`,
    });
  }

  return violations;
}

function inspectFoundationFile(file: string): BoundaryViolation[] {
  return inspectFoundationSource(
    relativeToConvex(file),
    readFileSync(file, "utf8"),
  );
}

describe("service-principal foundation boundary", () => {
  it("covers production modules and schemas", () => {
    for (const root of foundationRoots) {
      expect(
        productionFiles(root.path),
        `${root.label} must contain production TypeScript files`,
      ).not.toEqual([]);
    }
  });

  it("remains consumer-neutral and has no POS dependency", () => {
    const violations = foundationRoots
      .flatMap((root) => productionFiles(root.path))
      .flatMap(inspectFoundationFile);

    expect(violations).toEqual([]);
  });

  it("detects import, capability, filename, and identifier coupling", () => {
    const violations = [
      ...inspectFoundationSource(
        "servicePrincipals/posAuthority.ts",
        'import "../pos/application";\nexport const capability = "pos.application";',
      ),
      ...inspectFoundationSource(
        "schemas/servicePrincipals/session.ts",
        "export const terminalProof = true;",
      ),
    ];

    expect(violations.map(({ reason }) => reason)).toEqual([
      "consumer-specific filename",
      'imports POS module "../pos/application"',
      'declares consumer capability "pos.application"',
      "uses consumer-specific identifier terminalProof",
    ]);
  });

  it("does not confuse neutral words or namespaced fixtures with POS coupling", () => {
    expect(
      inspectFoundationSource(
        "servicePrincipals/capabilities.ts",
        'export const position = "fixture.application";',
      ),
    ).toEqual([]);
  });
});

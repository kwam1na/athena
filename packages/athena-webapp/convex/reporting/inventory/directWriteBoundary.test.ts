import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const CURRENT_COMPATIBILITY_WRITER_ALLOWLIST = new Set([
  "reporting/inventory/effects.ts",
]);
const INVENTORY_FIELDS = new Set([
  "inventoryCount",
  "quantityAvailable",
  "unitCost",
]);

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (
    !ts.isPropertyAssignment(node) &&
    !ts.isShorthandPropertyAssignment(node)
  ) {
    return null;
  }
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
    ? node.name.text
    : null;
}

function directlyWritesInventoryField(filePath: string): boolean {
  const sourceText = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  let writesInventory = false;

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "patch" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "productSku"
    ) {
      const patch = node.arguments[2];
      if (!patch || !ts.isObjectLiteralExpression(patch)) {
        writesInventory = true;
        return;
      }
      if (
        patch.properties.some((property) => {
          const name = propertyName(property);
          return name !== null && INVENTORY_FIELDS.has(name);
        })
      ) {
        writesInventory = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return writesInventory;
}

describe("inventory direct-write boundary", () => {
  it(
    "keeps direct product SKU inventory writes inside the migration allowlist",
    () => {
      const convexRoot = resolve(import.meta.dirname, "../..");
      const directWriters = listTypeScriptFiles(convexRoot)
        .filter(directlyWritesInventoryField)
        .map((filePath) => relative(convexRoot, filePath))
        .sort();
      const unapproved = directWriters.filter(
        (filePath) => !CURRENT_COMPATIBILITY_WRITER_ALLOWLIST.has(filePath),
      );

      expect(unapproved).toEqual([]);
      expect(directWriters).toContain("reporting/inventory/effects.ts");
    },
    20_000,
  );
});

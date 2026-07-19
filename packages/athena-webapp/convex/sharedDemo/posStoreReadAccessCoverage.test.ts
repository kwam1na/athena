import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const convexRoot = resolve(import.meta.dirname, "..");

function source(relativePath: string) {
  return readFileSync(resolve(convexRoot, relativePath), "utf8");
}

describe("shared-demo POS read access coverage", () => {
  it.each([
    "pos/public/register.ts",
    "inventory/posSessionItems.ts",
    "pos/public/customers.ts",
  ])("%s declares demo-aware read access", (relativePath) => {
    const file = source(relativePath);

    expect(file).toContain("requireStoreMemberAccessWithCtx");
    expect(file).toContain('{ kind: "read" }');
  });

  it.each([
    ["pos/application/commands/register.ts", "cash.control.write"],
    ["inventory/posSessionItems.ts", "pos.sale.complete"],
    ["inventory/posSessions.ts", "pos.sale.complete"],
    ["pos/public/customers.ts", "pos.sale.complete"],
    ["pos/public/catalog.ts", "pos.sale.complete"],
  ] as const)(
    "%s does not opt its mutation path into %s",
    (relativePath, capability) => {
      const file = source(relativePath);

      expect(file).not.toContain(`capability: "${capability}"`);
    },
  );
});

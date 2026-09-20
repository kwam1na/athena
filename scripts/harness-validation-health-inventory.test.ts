import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { collectCanonicalValidationRegistry } from "./harness-repo-validation";
import { buildValidationPlan } from "./harness-validation-plan";
import { validationCheckHealthScope } from "./harness-validation-ci-policy";
import {
  generateValidationHealthInventory,
  parseValidationHealthInventory,
} from "./harness-validation-health-inventory";

const full = (files: string[] = []) =>
  buildValidationPlan(
    collectCanonicalValidationRegistry(files),
    [],
    "full-health",
  );

describe("protected health inventory metadata", () => {
  it("names exactly the deduplicated full plan independent of test membership", () => {
    const staticPlan = full();
    const files = [
      "scripts/harness-generate.test.ts",
      "packages/athena-webapp/src/example.test.ts",
      "packages/storefront-webapp/src/example.test.ts",
    ];
    const populated = full(files);
    const inventory = generateValidationHealthInventory(staticPlan);
    expect(
      staticPlan.checks.some((check) => check.coveredChecks.length > 1),
    ).toBe(true);
    expect(inventory.checks.length).toBeLessThan(
      collectCanonicalValidationRegistry([]).checks.length,
    );
    expect(inventory).toEqual(generateValidationHealthInventory(populated));
    expect(inventory.checks).toEqual(
      populated.checks
        .map((check) => ({
          checkId: check.id,
          profile: check.profile,
          scope: validationCheckHealthScope(check.profile),
        }))
        .sort((a, b) => a.checkId.localeCompare(b.checkId)),
    );
    expect(inventory.checks.length).toBeGreaterThan(10);
    expect(new Set(inventory.checks.map((row) => row.checkId)).size).toBe(
      inventory.checks.length,
    );
    expect(
      parseValidationHealthInventory(JSON.parse(JSON.stringify(inventory))),
    ).toEqual(inventory);
  });

  it("refuses non-full plans and malformed, duplicate, unsorted or inconsistent metadata", () => {
    const valid = generateValidationHealthInventory(full());
    expect(() =>
      generateValidationHealthInventory({ ...full(), mode: "comparison" }),
    ).toThrow();
    for (const bad of [
      null,
      {},
      { ...valid, extra: true },
      { ...valid, checks: [] },
      { ...valid, checks: [...valid.checks].reverse() },
      { ...valid, checks: [valid.checks[0], valid.checks[0]] },
      {
        ...valid,
        checks: [{ ...valid.checks[0], membership: ["secret.test.ts"] }],
      },
      {
        ...valid,
        checks: [
          {
            checkId: "x",
            profile: "packages/example:unit",
            scope: { kind: "repo" },
          },
        ],
      },
      {
        ...valid,
        checks: [{ checkId: "", profile: "command", scope: { kind: "repo" } }],
      },
    ]) {
      expect(() => parseValidationHealthInventory(bad)).toThrow();
    }
  });

  it("parses in Node without loading candidate policy or Bun", () => {
    const value = generateValidationHealthInventory(full());
    const output = execFileSync(
      "node",
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `import { parseValidationHealthInventory } from ${JSON.stringify(new URL("./harness-validation-health-inventory.ts", import.meta.url).href)}; console.log(parseValidationHealthInventory(JSON.parse(process.argv[1])).checks.length)`,
        JSON.stringify(value),
      ],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          ATHENA_VALIDATION_MODE: "invalid-policy-must-not-load",
        },
      },
    );
    expect(Number(output.trim())).toBe(value.checks.length);
  });
});

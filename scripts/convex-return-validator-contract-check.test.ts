import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { collectConvexReturnValidatorContractFindings } from "./convex-return-validator-contract-check";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRepo() {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "athena-convex-return-validator-contract-"),
  );
  tempRoots.push(rootDir);
  return rootDir;
}

async function writePublicQueryWithReturns(rootDir: string) {
  await write(
    "packages/athena-webapp/convex/pos/public/example.ts",
    [
      'import { query } from "../../../_generated/server";',
      'import { v } from "convex/values";',
      "",
      "export const listExample = query({",
      "  args: { storeId: v.id(\"store\") },",
      "  returns: v.object({ status: v.string() }),",
      "  handler: async () => ({ status: \"ok\" }),",
      "});",
    ].join("\n"),
    rootDir,
  );
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
  );
});

describe("collectConvexReturnValidatorContractFindings", () => {
  it("fails changed public Convex functions with returns when no sibling proof changed", async () => {
    const rootDir = await createFixtureRepo();
    await writePublicQueryWithReturns(rootDir);

    const findings = await collectConvexReturnValidatorContractFindings(
      rootDir,
      ["packages/athena-webapp/convex/pos/public/example.ts"],
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        id: "missing-convex-return-validator-contract-proof-packages-athena-webapp-convex-pos-public-example-ts",
        severity: "high",
        filePath: "packages/athena-webapp/convex/pos/public/example.ts",
        remediation: expect.stringContaining(
          "assertConformsToExportedReturns",
        ),
      }),
    );
  });

  it("passes when a changed sibling test uses the executable return contract helper", async () => {
    const rootDir = await createFixtureRepo();
    await writePublicQueryWithReturns(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/example.test.ts",
      [
        'import { listExample } from "./example";',
        'import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";',
        "",
        "assertConformsToExportedReturns(listExample, { status: \"ok\" });",
      ].join("\n"),
      rootDir,
    );

    const findings = await collectConvexReturnValidatorContractFindings(
      rootDir,
      [
        "packages/athena-webapp/convex/pos/public/example.ts",
        "packages/athena-webapp/convex/pos/public/example.test.ts",
      ],
    );

    expect(findings).toEqual([]);
  });

  it("does not accept loose exportReturns string checks as proof", async () => {
    const rootDir = await createFixtureRepo();
    await writePublicQueryWithReturns(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/example.test.ts",
      [
        'import { expect, it } from "vitest";',
        'import { listExample } from "./example";',
        "",
        'it("exports status", () => {',
        "  expect((listExample as any).exportReturns()).toContain(\"status\");",
        "});",
      ].join("\n"),
      rootDir,
    );

    const findings = await collectConvexReturnValidatorContractFindings(
      rootDir,
      [
        "packages/athena-webapp/convex/pos/public/example.ts",
        "packages/athena-webapp/convex/pos/public/example.test.ts",
      ],
    );

    expect(findings).toHaveLength(1);
  });

  it("ignores helper-shaped comments and string literals", async () => {
    const rootDir = await createFixtureRepo();
    await writePublicQueryWithReturns(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/example.test.ts",
      [
        'import { listExample } from "./example";',
        "",
        "// assertConformsToExportedReturns(listExample, { status: \"ok\" });",
        "const note = \"assertConformsToExportedReturns(listExample, { status: 'ok' })\";",
      ].join("\n"),
      rootDir,
    );

    const findings = await collectConvexReturnValidatorContractFindings(
      rootDir,
      [
        "packages/athena-webapp/convex/pos/public/example.ts",
        "packages/athena-webapp/convex/pos/public/example.test.ts",
      ],
    );

    expect(findings).toHaveLength(1);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectOperationAdmissionCheckResult,
  collectPublicMutationExportsFromSource,
} from "./convex-operation-admission-check";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-op-admission-"));
  tempRoots.push(rootDir);
  await mkdir(path.join(rootDir, "packages/athena-webapp/convex"), {
    recursive: true,
  });
  return rootDir;
}

async function writeFixture(
  rootDir: string,
  relativePath: string,
  source: string,
) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
  );
});

describe("collectPublicMutationExportsFromSource", () => {
  it("discovers exported public mutations and ignores internal registrations", () => {
    const exports = collectPublicMutationExportsFromSource(
      "packages/athena-webapp/convex/example/publicWrites.ts",
      `
        import { internalMutation, mutation, action } from "../_generated/server";

        export const publicWrite = mutation({ args: {}, handler: async () => null });
        export const privateWrite = internalMutation({ args: {}, handler: async () => null });
        export const publicAction = action({ args: {}, handler: async () => null });
      `,
    );

    expect(exports).toEqual([
      expect.objectContaining({
        exportName: "publicWrite",
        functionName: "example/publicWrites:publicWrite",
        hasOperationAdmissionWrapper: false,
      }),
    ]);
  });

  it("detects public mutations routed through the operation admission wrapper", () => {
    const exports = collectPublicMutationExportsFromSource(
      "packages/athena-webapp/convex/example/admitted.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../operationAdmission/publicMutation";
        import { definition } from "../operationAdmission/definitions";

        export const admittedWrite = mutation({
          args: {},
          handler: admitPublicMutation(definition, async () => null),
        });
      `,
    );

    expect(exports).toEqual([
      expect.objectContaining({
        functionName: "example/admitted:admittedWrite",
        hasOperationAdmissionWrapper: true,
      }),
    ]);
  });

  it("detects public mutations routed through the shared-demo admission wrapper", () => {
    const exports = collectPublicMutationExportsFromSource(
      "packages/athena-webapp/convex/example/sharedDemoAdmitted.ts",
      `
        import { mutation } from "../_generated/server";
        import { withOperationMutationAdmission } from "../operationAdmission/publicMutation";
        import { definition } from "../operationAdmission/definitions";

        export const admittedWrite = mutation({
          args: {},
          handler: withOperationMutationAdmission(definition, async () => null),
        });
      `,
    );

    expect(exports).toEqual([
      expect.objectContaining({
        functionName: "example/sharedDemoAdmitted:admittedWrite",
        hasOperationAdmissionWrapper: true,
      }),
    ]);
  });

  it("detects public mutations routed through a named operation admission wrapper", () => {
    const exports = collectPublicMutationExportsFromSource(
      "packages/athena-webapp/convex/example/namedAdmitted.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../operationAdmission/publicMutation";
        import { definition } from "../operationAdmission/definitions";

        const admittedHandler = admitPublicMutation(definition, async () => null);

        export const admittedWrite = mutation({
          args: {},
          handler: admittedHandler,
        });
      `,
    );

    expect(exports).toEqual([
      expect.objectContaining({
        functionName: "example/namedAdmitted:admittedWrite",
        hasOperationAdmissionWrapper: true,
      }),
    ]);
  });

  it("detects handlers that call a named admission wrapper before mapping errors", () => {
    const exports = collectPublicMutationExportsFromSource(
      "packages/athena-webapp/convex/example/caughtAdmitted.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../operationAdmission/publicMutation";
        import { definition } from "../operationAdmission/definitions";

        const admittedHandler = admitPublicMutation(definition, async () => null);

        export const admittedWrite = mutation({
          args: {},
          handler: async (ctx, args) => {
            try {
              return await admittedHandler(ctx, args);
            } catch (error) {
              return { kind: "user_error", error: String(error) };
            }
          },
        });
      `,
    );

    expect(exports).toEqual([
      expect.objectContaining({
        functionName: "example/caughtAdmitted:admittedWrite",
        hasOperationAdmissionWrapper: true,
      }),
    ]);
  });

  it("does not accept public writes before a named admission wrapper call", () => {
    const exports = collectPublicMutationExportsFromSource(
      "packages/athena-webapp/convex/example/preWriteThenAdmitted.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../operationAdmission/publicMutation";
        import { definition } from "../operationAdmission/definitions";

        const admittedHandler = admitPublicMutation(definition, async () => null);

        export const admittedWrite = mutation({
          args: {},
          handler: async (ctx, args) => {
            await ctx.db.insert("auditLog", { action: "pre-admission" });
            return admittedHandler(ctx, args);
          },
        });
      `,
    );

    expect(exports).toEqual([
      expect.objectContaining({
        functionName: "example/preWriteThenAdmitted:admittedWrite",
        hasOperationAdmissionWrapper: false,
      }),
    ]);
  });

  it("does not accept branch-local public writes next to a named admission wrapper call", () => {
    const exports = collectPublicMutationExportsFromSource(
      "packages/athena-webapp/convex/example/branchedWriteAdmitted.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../operationAdmission/publicMutation";
        import { definition } from "../operationAdmission/definitions";

        const admittedHandler = admitPublicMutation(definition, async () => null);

        export const admittedWrite = mutation({
          args: {},
          handler: async (ctx, args) => {
            if (args.useAdmission) {
              return admittedHandler(ctx, args);
            }
            await ctx.db.insert("auditLog", { action: "branch-write" });
            return null;
          },
        });
      `,
    );

    expect(exports).toEqual([
      expect.objectContaining({
        functionName: "example/branchedWriteAdmitted:admittedWrite",
        hasOperationAdmissionWrapper: false,
      }),
    ]);
  });

  it("supports aliased and namespace imports from generated server", () => {
    expect(
      collectPublicMutationExportsFromSource(
        "packages/athena-webapp/convex/example/aliased.ts",
        `
          import { mutation as publicMutation } from "../_generated/server";
          export const aliasedWrite = publicMutation({ args: {}, handler: async () => null });
        `,
      ),
    ).toEqual([
      expect.objectContaining({
        functionName: "example/aliased:aliasedWrite",
      }),
    ]);

    expect(
      collectPublicMutationExportsFromSource(
        "packages/athena-webapp/convex/example/namespaced.ts",
        `
          import * as server from "../_generated/server";
          export const namespacedWrite = server.mutation({ args: {}, handler: async () => null });
        `,
      ),
    ).toEqual([
      expect.objectContaining({
        functionName: "example/namespaced:namespacedWrite",
      }),
    ]);
  });

  it("excludes tests and generated files", () => {
    expect(
      collectPublicMutationExportsFromSource(
        "packages/athena-webapp/convex/example.test.ts",
        `
          import { mutation } from "./_generated/server";
          export const testWrite = mutation({ args: {}, handler: async () => null });
        `,
      ),
    ).toEqual([]);

    expect(
      collectPublicMutationExportsFromSource(
        "packages/athena-webapp/convex/_generated/api.ts",
        `
          import { mutation } from "./server";
          export const generatedWrite = mutation({ args: {}, handler: async () => null });
        `,
      ),
    ).toEqual([]);
  });
});

describe("collectOperationAdmissionCheckResult", () => {
  it("passes when every discovered public mutation has a definition or named legacy exemption", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixture(
      rootDir,
      "packages/athena-webapp/convex/inventory/products.ts",
      `
        import { admitPublicMutation } from "../operationAdmission/publicMutation";
        import { mutation } from "../_generated/server";
        export const create = mutation({
          args: {},
          handler: admitPublicMutation({} as never, async () => null),
        });
        export const archive = mutation({ args: {}, handler: async () => null });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [
        {
          functionName: "inventory/products:create",
          capability: "catalog.manage",
        },
      ],
      legacyExemptions: [
        {
          functionName: "inventory/products:archive",
          capability: "catalog.manage",
          wave: "catalog",
          owner: "V26-1094",
          reason: "Pending operation admission migration.",
        },
      ],
    });

    expect(result.findings).toEqual([]);
    expect(result.coveredByDefinitions).toHaveLength(1);
    expect(result.coveredByLegacyExemptions).toHaveLength(1);
  });

  it("fails a new raw public mutation that is not declared or inventoried", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixture(
      rootDir,
      "packages/athena-webapp/convex/operations/raw.ts",
      `
        import { mutation } from "../_generated/server";
        export const rawWrite = mutation({ args: {}, handler: async () => null });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [],
      legacyExemptions: [],
    });

    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "missing-operation-admission-coverage-operations-raw-rawwrite",
        functionName: "operations/raw:rawWrite",
        severity: "high",
      }),
    ]);
  });

  it("fails a defined public mutation that is not routed through admission", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixture(
      rootDir,
      "packages/athena-webapp/convex/operations/rawDefined.ts",
      `
        import { mutation } from "../_generated/server";
        export const write = mutation({ args: {}, handler: async () => null });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [
        {
          functionName: "operations/rawDefined:write",
          capability: "daily_operations.write",
        },
      ],
      legacyExemptions: [],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "definition-covered-mutation-missing-admission-wrapper-operations-rawdefined-write",
          functionName: "operations/rawDefined:write",
          severity: "high",
        }),
      ]),
    );
  });

  it("flags invalid operation definitions and stale inventory entries", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixture(
      rootDir,
      "packages/athena-webapp/convex/operations/admitted.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../operationAdmission/publicMutation";
        export const write = mutation({
          args: {},
          handler: admitPublicMutation({} as never, async () => null),
        });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [
        { capability: "daily_operations.write" },
        { functionName: "operations/admitted:write" },
        {
          functionName: "operations/admitted:write",
          capability: "daily_operations.write",
        },
        {
          functionName: "operations/missing:write",
          capability: "daily_operations.write",
        },
      ],
      legacyExemptions: [
        {
          functionName: "operations/missingLegacy:write",
          capability: "daily_operations.write",
          wave: "daily-operations",
          owner: "V26-1094",
          reason: "Pending operation admission migration.",
        },
      ],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "operation-definition-missing-function-name",
        }),
        expect.objectContaining({
          id: "operation-definition-missing-capability-operations-admitted-write",
        }),
        expect.objectContaining({
          id: "duplicate-operation-definition-operations-admitted-write",
        }),
        expect.objectContaining({
          id: "stale-operation-admission-entry-operations-missing-write",
        }),
        expect.objectContaining({
          id: "stale-operation-admission-entry-operations-missinglegacy-write",
        }),
      ]),
    );
  });

  it("flags duplicate and incomplete legacy exemptions", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixture(
      rootDir,
      "packages/athena-webapp/convex/operations/exempted.ts",
      `
        import { mutation } from "../_generated/server";
        export const write = mutation({ args: {}, handler: async () => null });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [],
      legacyExemptions: [
        {
          functionName: "operations/exempted:write",
          capability: "daily_operations.write",
          wave: "",
          owner: "V26-1094",
          reason: "Pending operation admission migration.",
        },
        {
          functionName: "operations/exempted:write",
          capability: "daily_operations.write",
          wave: "daily-operations",
          owner: "V26-1094",
          reason: "Pending operation admission migration.",
        },
      ],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "legacy-operation-exemption-incomplete-operations-exempted-write",
        }),
        expect.objectContaining({
          id: "duplicate-legacy-operation-exemption-operations-exempted-write",
        }),
      ]),
    );
  });
});

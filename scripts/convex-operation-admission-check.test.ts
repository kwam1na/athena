import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertCorsAllowlist,
  CANONICAL_WRAPPERS,
  collectApiSelfCallSites,
  collectConvexIngressFromSource,
  collectOperationAdmissionCheckResult,
  formatCallerTable,
  formatDownstreamWrites,
  formatPartitionReport,
  FRAMEWORK_ENTRY_POINTS,
  ownerOfConvexPath,
  parseCliArguments,
  runCli,
  UNIT_OWNERSHIP,
} from "./convex-operation-admission-check";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-op-admission-"));
  tempRoots.push(rootDir);
  await mkdir(path.join(rootDir, "packages/athena-webapp/convex"), {
    recursive: true,
  });
  await mkdir(path.join(rootDir, "docs/plans"), { recursive: true });
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

function convexFixture(rootDir: string, convexPath: string, source: string) {
  return writeFixture(
    rootDir,
    `packages/athena-webapp/convex/${convexPath}`,
    source,
  );
}

/** A router module that mounts one admitted read route, so fixtures pass. */
const ADMITTED_ROUTER = `
  import { Hono } from "hono";
  import { cors } from "hono/cors";
  import { auth } from "./auth";
  import { HonoWithConvex, HttpRouterWithHono } from "convex-helpers/server/hono";
  import { ActionCtx } from "./_generated/server";
  import { admitHttpRead } from "./platform/operationAdmission";
  import { healthReadDefinition } from "./operationAdmission/readDefinitions";
  import { STOREFRONT_ALLOWED_ORIGINS } from "./platform/storefrontOrigins";

  const app: HonoWithConvex<ActionCtx> = new Hono();
  const http = new HttpRouterWithHono<ActionCtx>(app);
  auth.addHttpRoutes(http);

  app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true }));

  app.get("/health", admitHttpRead(healthReadDefinition, async (c) => c.json({})));

  export default http;
`;

const AUTH_MODULE = `
  import { convexAuth } from "@convex-dev/auth/server";
  export const { auth, signIn, signOut, store } = convexAuth({ providers: [] });
`;

const HEALTH_READ_DEFINITION = {
  kind: "http_read",
  route: { method: "GET", path: "/health" },
  operationId: "http.health.read",
  access: { kind: "read", intent: "platform.health.view" },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "admit" },
};

async function writeBaselineTree(rootDir: string) {
  await convexFixture(rootDir, "auth.ts", AUTH_MODULE);
  await convexFixture(rootDir, "http.ts", ADMITTED_ROUTER);
}

/**
 * Real definition modules on disk, so the CLI path exercises the same loader
 * the gate uses rather than injected options.
 */
async function writeDefinitionModules(
  rootDir: string,
  writes: unknown[],
  reads: unknown[],
) {
  await convexFixture(
    rootDir,
    "operationAdmission/definitions.ts",
    `export const OPERATION_ADMISSION_DEFINITIONS = ${JSON.stringify(writes)};`,
  );
  await convexFixture(
    rootDir,
    "operationAdmission/readDefinitions.ts",
    `export const OPERATION_READ_ADMISSION_DEFINITIONS = ${JSON.stringify(reads)};`,
  );
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
  );
});

describe("contract constants", () => {
  it("names exactly the five canonical wrappers, one per ingress kind", () => {
    expect(CANONICAL_WRAPPERS).toEqual({
      admitPublicMutation: "mutation",
      admitPublicQuery: "query",
      admitPublicAction: "action",
      admitHttpRoute: "http",
      admitHttpRead: "http_read",
    });
  });

  it("has no exemption or inventory concept, only framework entry points", () => {
    expect(FRAMEWORK_ENTRY_POINTS.map((entry) => entry.id)).toEqual([
      "auth:auth",
      "auth:signIn",
      "auth:signOut",
      "auth:store",
      "auth.addHttpRoutes",
    ]);
    for (const entry of FRAMEWORK_ENTRY_POINTS) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  it("assigns every ownership row a disjoint file set", () => {
    const seen = new Set<string>();
    for (const row of UNIT_OWNERSHIP) {
      for (const file of row.files ?? []) {
        expect(seen.has(file)).toBe(false);
        seen.add(file);
      }
    }
    expect(ownerOfConvexPath("pos/public/sync.ts")).toBe("U2");
    expect(ownerOfConvexPath("http/domains/customerChannel/routes/bag.ts")).toBe(
      "U10",
    );
    expect(ownerOfConvexPath("http.ts")).toBe("U11");
    expect(ownerOfConvexPath("auth.ts")).toBe("framework");
    expect(ownerOfConvexPath("nowhere/orphan.ts")).toBeUndefined();
  });
});

describe("collectConvexIngressFromSource", () => {
  it("discovers public mutations, queries, and actions and ignores internal ones", () => {
    const ingress = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/surface.ts",
      `
        import { action, internalMutation, mutation, query } from "../_generated/server";

        export const write = mutation({ args: {}, handler: async () => null });
        export const read = query({ args: {}, handler: async () => null });
        export const run = action({ args: {}, handler: async () => null });
        export const hidden = internalMutation({ args: {}, handler: async () => null });
      `,
    );

    expect(ingress.map((entry) => [entry.id, entry.kind, entry.admitted])).toEqual([
      ["example/surface:write", "mutation", false],
      ["example/surface:read", "query", false],
      ["example/surface:run", "action", false],
    ]);
  });

  it("recognizes the canonical wrappers imported from the composition root", () => {
    const ingress = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/admitted.ts",
      `
        import { action, mutation, query } from "../_generated/server";
        import {
          admitPublicAction,
          admitPublicMutation,
          admitPublicQuery,
        } from "../platform/operationAdmission";
        import { definition } from "../operationAdmission/definitions";

        export const write = mutation({ args: {}, handler: admitPublicMutation(definition, async () => null) });
        export const read = query({ args: {}, handler: admitPublicQuery(definition, async () => null) });
        export const run = action({ args: {}, handler: admitPublicAction(definition, async () => null) });
      `,
    );

    expect(ingress.every((entry) => entry.admitted)).toBe(true);
    expect(ingress.every((entry) => !entry.wrapperOffComposition)).toBe(true);
  });

  it("flags a canonical wrapper imported from somewhere other than the composition root", () => {
    const [entry] = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/offRoot.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../operationAdmission/publicMutation";
        import { definition } from "../operationAdmission/definitions";

        export const write = mutation({ args: {}, handler: admitPublicMutation(definition, async () => null) });
      `,
    );

    expect(entry.admitted).toBe(true);
    expect(entry.wrapperOffComposition).toBe(true);
  });

  it("does not recognize the retired pre-rename wrapper alias names", () => {
    const [entry] = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/legacy.ts",
      `
        import { mutation } from "../_generated/server";
        import { withOperationMutationAdmission } from "../platform/operationAdmission";
        import { definition } from "../operationAdmission/definitions";

        export const write = mutation({
          args: {},
          handler: withOperationMutationAdmission(definition, async () => null),
        });
      `,
    );

    expect(entry.admitted).toBe(false);
  });

  it("resolves a hoisted wrapper const and rejects a public write before it", () => {
    const admitted = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/hoisted.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../platform/operationAdmission";
        import { definition } from "../operationAdmission/definitions";

        const admittedHandler = admitPublicMutation(definition, async () => null);

        export const write = mutation({
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
    expect(admitted[0].admitted).toBe(true);

    const preWrite = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/preWrite.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../platform/operationAdmission";
        import { definition } from "../operationAdmission/definitions";

        const admittedHandler = admitPublicMutation(definition, async () => null);

        export const write = mutation({
          args: {},
          handler: async (ctx, args) => {
            await ctx.db.insert("auditLog", { action: "pre-admission" });
            return admittedHandler(ctx, args);
          },
        });
      `,
    );
    expect(preWrite[0].admitted).toBe(false);
  });

  /**
   * The positional rule. "The wrapper is called somewhere in this body" is not
   * admission: anything ahead of it runs for a caller nobody admitted, and a
   * wrapper nested in a branch admits on some paths only.
   */
  describe("wrapper position", () => {
    const PROLOGUE = `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../platform/operationAdmission";
        import { definition } from "../operationAdmission/definitions";
    `;

    const inlineHandler = (body: string) =>
      collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/position.ts",
        `${PROLOGUE}
        export const write = mutation({
          args: {},
          handler: async (ctx, args) => {${body}},
        });
      `,
      )[0];

    it("accepts the wrapper as the first statement", () => {
      const entry = inlineHandler(`
            return await admitPublicMutation(definition, async () => null)(ctx, args);
      `);
      expect(entry.admitted).toBe(true);
      expect(entry.wrapperNotFirst).toBeFalsy();
    });

    it("accepts a try whose block starts with the wrapper", () => {
      const entry = inlineHandler(`
            try {
              return await admitPublicMutation(definition, async () => null)(ctx, args);
            } catch (error) {
              return { kind: "user_error", error: String(error) };
            }
      `);
      expect(entry.admitted).toBe(true);
      expect(entry.wrapperNotFirst).toBeFalsy();
    });

    it.each([
      [
        "a read before admission",
        `const row = await ctx.db.get(args.id);
         return admitPublicMutation(definition, async () => row)(ctx, args);`,
      ],
      [
        "a runQuery before admission",
        `const seen = await ctx.runQuery(internal.some.probe, {});
         return admitPublicMutation(definition, async () => seen)(ctx, args);`,
      ],
      [
        "a runMutation before admission",
        `await ctx.runMutation(internal.some.write, {});
         return admitPublicMutation(definition, async () => null)(ctx, args);`,
      ],
      [
        "a scheduler call before admission",
        `await ctx.scheduler.runAfter(0, internal.some.job, {});
         return admitPublicMutation(definition, async () => null)(ctx, args);`,
      ],
      [
        "a second admission probe before the wrapper",
        `await resolveWriteAdmission(ctx, args, definition);
         return admitPublicMutation(definition, async () => null)(ctx, args);`,
      ],
      [
        "the wrapper nested in a branch",
        `if (args.mode === "admit") {
           return admitPublicMutation(definition, async () => null)(ctx, args);
         }
         return null;`,
      ],
    ])("rejects %s", (_label, body) => {
      const entry = inlineHandler(`\n${body}\n`);
      expect(entry.admitted).toBe(false);
      expect(entry.wrapperNotFirst).toBe(true);
    });

    /**
     * `const run = admitPublicMutation(def, fn)` BUILDS the closure; admission
     * happens when `run(ctx, args)` is invoked. Treating the declaration as
     * proof let a handler write rows before any caller was admitted while the
     * checker called it admitted.
     */
    it("rejects a const-bound wrapper declaration as proof of admission", () => {
      const entry = inlineHandler(`
            const run = admitPublicMutation(definition, async () => null);
            await ctx.db.insert("auditLog", { action: "pre-admission" });
            await ctx.runMutation(internal.some.write, {});
            return run(ctx, args);
      `);
      expect(entry.admitted).toBe(false);
      expect(entry.wrapperNotFirst).toBe(true);
    });

    it("rejects a hoisted wrapper invoked after other work", () => {
      const entry = collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/hoistedLate.ts",
        `${PROLOGUE}
        const admittedHandler = admitPublicMutation(definition, async () => null);

        export const write = mutation({
          args: {},
          handler: async (ctx, args) => {
            const existing = await ctx.db.get(args.id);
            return admittedHandler(ctx, args);
          },
        });
      `,
      )[0];
      expect(entry.admitted).toBe(false);
      expect(entry.wrapperNotFirst).toBe(true);
    });

    it("still accepts a hoisted wrapper invoked as the first statement", () => {
      const entry = collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/hoistedFirst.ts",
        `${PROLOGUE}
        const admittedHandler = admitPublicMutation(definition, async () => null);

        export const write = mutation({
          args: {},
          handler: async (ctx, args) => {
            return admittedHandler(ctx, args);
          },
        });
      `,
      )[0];
      expect(entry.admitted).toBe(true);
      expect(entry.wrapperNotFirst).toBeFalsy();
    });

    /**
     * A call's callee is evaluated before its arguments, so the wrapper closure
     * is only BUILT first — everything in the argument list runs next, and
     * admission happens last. A rule that is positional over statements alone
     * never looks inside the invocation it accepts.
     */
    describe("pre-admission work in the invocation's arguments", () => {
      it.each([
        [
          "an awaited read in the applied argument list",
          `return admitPublicMutation(definition, async () => null)(ctx, { ...args, row: await ctx.db.get(args.id) });`,
        ],
        [
          "an awaited handler build in the wrapper's own argument list",
          `return admitPublicMutation(definition, await buildHandler(ctx))(ctx, args);`,
        ],
        [
          "an unawaited ctx.runMutation in the applied argument list",
          `return admitPublicMutation(definition, async () => null)(ctx, { probe: ctx.runMutation(internal.some.write, {}) });`,
        ],
        [
          "an unawaited ctx.db write in the applied argument list",
          `return admitPublicMutation(definition, async () => null)(ctx, { probe: ctx.db.insert("auditLog", {}) });`,
        ],
        [
          "an unawaited scheduler call in the applied argument list",
          `return admitPublicMutation(definition, async () => null)(ctx, { probe: ctx.scheduler.runAfter(0, internal.some.job, {}) });`,
        ],
      ])("rejects %s", (_label, body) => {
        const entry = inlineHandler(`\n${body}\n`);
        expect(entry.admitted).toBe(false);
        expect(entry.wrapperNotFirst).toBe(true);
      });

      it("rejects it in a concise arrow body too", () => {
        const entry = collectConvexIngressFromSource(
          "packages/athena-webapp/convex/example/conciseArgs.ts",
          `${PROLOGUE}
          export const write = mutation({
            args: {},
            handler: async (ctx, args) =>
              admitPublicMutation(definition, async () => null)(ctx, { ...args, row: await ctx.db.get(args.id) }),
          });
        `,
        )[0];
        expect(entry.admitted).toBe(false);
        expect(entry.wrapperNotFirst).toBe(true);
      });

      it("rejects it in a hoisted wrapper's first-statement invocation", () => {
        const entry = collectConvexIngressFromSource(
          "packages/athena-webapp/convex/example/hoistedArgs.ts",
          `${PROLOGUE}
          const admittedHandler = admitPublicMutation(definition, async () => null);

          export const write = mutation({
            args: {},
            handler: async (ctx, args) => {
              return admittedHandler(ctx, { ...args, row: await ctx.db.get(args.id) });
            },
          });
        `,
        )[0];
        expect(entry.admitted).toBe(false);
        expect(entry.wrapperNotFirst).toBe(true);
      });

      /**
       * The negative control. The admitted handler is itself an argument, and
       * everything in it runs AFTER admission — a walk that descended into it
       * would reject every correctly admitted ingress in the repo.
       */
      it("still accepts an invocation whose arguments do no pre-admission work", () => {
        const entry = inlineHandler(`
              return await admitPublicMutation(definition, async (ctx, args) => {
                const row = await ctx.db.get(args.id);
                await ctx.db.insert("auditLog", { row });
                return ctx.runMutation(internal.some.write, {});
              })(ctx, args);
        `);
        expect(entry.admitted).toBe(true);
        expect(entry.wrapperNotFirst).toBeFalsy();
      });
    });

    it("reports no wrapper at all as unadmitted WITHOUT the positional flag", () => {
      const entry = inlineHandler(`
            return await someOtherHelper(ctx, args);
      `);
      expect(entry.admitted).toBe(false);
      // Different remediation: "add the wrapper" vs "move the wrapper first".
      expect(entry.wrapperNotFirst).toBeFalsy();
    });
  });

  /**
   * Wrapper identity used to be resolved by bare method name on ANY receiver,
   * so a local shim — or any unrelated module with a same-named export — passed
   * as canonical composition-root admission. That is an exemption construct by
   * another name: the rail could be stood down file by file while the checker
   * reported zero findings.
   */
  describe("wrapper identity through property access", () => {
    it("does not admit a same-named method on an unrelated receiver", () => {
      const ingress = collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/shim.ts",
        `
          import { mutation } from "../_generated/server";
          import { admitPublicMutation } from "../platform/operationAdmission";
          import { definition } from "../operationAdmission/definitions";

          const shim = { admitPublicMutation: (d, f) => f };

          export const real = mutation({ args: {}, handler: admitPublicMutation(definition, async () => null) });
          export const shimmed = mutation({
            args: {},
            handler: async (ctx, args) => {
              return shim.admitPublicMutation(definition, async () => null)(ctx, args);
            },
          });
        `,
      );

      expect(ingress.map((entry) => [entry.id, entry.admitted])).toEqual([
        ["example/shim:real", true],
        ["example/shim:shimmed", false],
      ]);
    });

    it("does not admit a wrapper-named method on an unrelated namespace import", () => {
      const [entry] = collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/nsHelper.ts",
        `
          import { mutation } from "../_generated/server";
          import * as helpers from "./myHelpers";
          import { definition } from "../operationAdmission/definitions";

          const run = helpers.admitPublicMutation(definition, async () => null);

          export const write = mutation({
            args: {},
            handler: async (ctx, args) => {
              return run(ctx, args);
            },
          });
        `,
      );

      expect(entry.admitted).toBe(false);
    });

    it("admits a namespace import of the composition root itself", () => {
      const [entry] = collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/nsRoot.ts",
        `
          import { mutation } from "../_generated/server";
          import * as admission from "../platform/operationAdmission";
          import { definition } from "../operationAdmission/definitions";

          export const write = mutation({
            args: {},
            handler: async (ctx, args) => {
              return admission.admitPublicMutation(definition, async () => null)(ctx, args);
            },
          });
        `,
      );

      expect(entry.admitted).toBe(true);
      expect(entry.wrapperOffComposition).toBeFalsy();
    });
  });

  it("discovers destructured convexAuth registrar exports", () => {
    const ingress = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/auth.ts",
      AUTH_MODULE,
    );

    expect(ingress.map((entry) => entry.id)).toEqual([
      "auth:auth",
      "auth:signIn",
      "auth:signOut",
      "auth:store",
    ]);
    expect(ingress.every((entry) => entry.kind === "registrar")).toBe(true);
  });

  it("supports aliased and namespace registrations and excludes tests", () => {
    expect(
      collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/aliased.ts",
        `
          import { mutation as publicMutation } from "../_generated/server";
          import * as server from "../_generated/server";
          export const aliased = publicMutation({ args: {}, handler: async () => null });
          export const namespaced = server.query({ args: {}, handler: async () => null });
        `,
      ).map((entry) => entry.id),
    ).toEqual(["example/aliased:aliased", "example/aliased:namespaced"]);

    expect(
      collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example.test.ts",
        `
          import { mutation } from "./_generated/server";
          export const testWrite = mutation({ args: {}, handler: async () => null });
        `,
      ),
    ).toEqual([]);
  });
});

describe("collectApiSelfCallSites", () => {
  it("resolves api.* references through import aliases, consts, and destructuring", () => {
    const sites = collectApiSelfCallSites(
      "packages/athena-webapp/convex/example/selfCalls.ts",
      `
        import { api as publicApi, internal } from "../_generated/api";
        import * as generated from "../_generated/api";

        const bagApi = publicApi.storeFront.bag;
        const { storeFront } = generated.api;

        export async function run(ctx) {
          await ctx.runQuery(bagApi.getByUserId, {});
          await ctx.runMutation(storeFront.bagItem.addItemToBag, {});
          await ctx.runAction(publicApi.llm.storeInsights.generate, {});
          await ctx.scheduler.runAfter(0, publicApi.storeFront.rewards.award, {});
          await ctx.scheduler.runAt(0, generated.api.storeFront.rewards.award, {});
          await ctx.runMutation(internal.storeFront.bag.create, {});
        }
      `,
    );

    expect(sites.map((site) => site.via)).toEqual([
      "runQuery",
      "runMutation",
      "runAction",
      "runAfter",
      "runAt",
    ]);
    expect(sites.every((site) => site.reference.includes("."))).toBe(true);
  });

  it("ignores internal-only references", () => {
    expect(
      collectApiSelfCallSites(
        "packages/athena-webapp/convex/example/internalOnly.ts",
        `
          import { internal } from "../_generated/api";
          export async function run(ctx) {
            await ctx.runMutation(internal.storeFront.bag.create, {});
            await ctx.scheduler.runAfter(0, internal.storeFront.bag.create, {});
          }
        `,
      ),
    ).toEqual([]);
  });
});

describe("assertCorsAllowlist", () => {
  it("fails a reflect-any-origin callback", () => {
    const assertion = assertCorsAllowlist(
      "packages/athena-webapp/convex/http.ts",
      `
        import { cors } from "hono/cors";
        app.use("*", cors({ origin: (origin) => origin, credentials: true }));
      `,
    );
    expect(assertion.found).toBe(true);
    expect(assertion.allowlisted).toBe(false);
  });

  it("fails the wildcard and passes a fixed allowlist", () => {
    expect(
      assertCorsAllowlist(
        "packages/athena-webapp/convex/http.ts",
        `import { cors } from "hono/cors";\napp.use("*", cors({ origin: "*" }));`,
      ).allowlisted,
    ).toBe(false);

    expect(
      assertCorsAllowlist(
        "packages/athena-webapp/convex/http.ts",
        `import { cors } from "hono/cors";\napp.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS }));`,
      ).allowlisted,
    ).toBe(true);
  });
});

describe("parseCliArguments", () => {
  it("parses the flag surface", () => {
    expect(
      parseCliArguments([
        "--path",
        "pos/public/",
        "inventory/",
        "--partition",
        "--callers",
        "--downstream-writes",
      ]),
    ).toEqual({
      paths: ["pos/public/", "inventory/"],
      partition: true,
      callers: true,
      downstreamWrites: true,
    });
    expect(parseCliArguments(["--path=reports/"]).paths).toEqual(["reports/"]);
  });
});

describe("collectOperationAdmissionCheckResult", () => {
  it("passes a fully wrapped fixture tree", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "inventory/products.ts",
      `
        import { mutation, query } from "../_generated/server";
        import { admitPublicMutation, admitPublicQuery } from "../platform/operationAdmission";
        import { def, readDef } from "../operationAdmission/definitions";

        export const create = mutation({ args: {}, handler: admitPublicMutation(def, async () => null) });
        export const list = query({ args: {}, handler: admitPublicQuery(readDef, async () => null) });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [
        {
          kind: "mutation",
          functionName: "inventory/products:create",
          operationId: "inventory.products.create",
          capability: "catalog.manage",
        },
      ],
      readDefinitions: [
        {
          kind: "query",
          functionName: "inventory/products:list",
          operationId: "inventory.products.list.read",
          access: { kind: "read", intent: "inventory.catalog.view" },
        },
        HEALTH_READ_DEFINITION,
      ],
    });

    expect(result.findings).toEqual([]);
    expect(result.orphanFiles).toEqual([]);
  });

  it("flags a raw query, a raw action, and a raw mutation with one finding each", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "inventory/products.ts",
      `
        import { action, mutation, query } from "../_generated/server";
        export const create = mutation({ args: {}, handler: async () => null });
        export const list = query({ args: {}, handler: async () => null });
        export const sync = action({ args: {}, handler: async () => null });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    expect(result.findings.map((finding) => finding.id).sort()).toEqual([
      "unadmitted-action-inventory-products-sync",
      "unadmitted-mutation-inventory-products-create",
      "unadmitted-query-inventory-products-list",
    ]);
    expect(result.findings.every((finding) => finding.severity === "high")).toBe(
      true,
    );
  });

  it("flags raw routes in both the verb form and the .on form, with mounted paths", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http/domains/customerChannel/routes/bag.ts",
      `
        import { Hono } from "hono";
        import { HonoWithConvex } from "convex-helpers/server/hono";
        const bagRoutes: HonoWithConvex<any> = new Hono();
        bagRoutes.post("/:bagId/items", async (c) => c.json({}));
        export { bagRoutes };
      `,
    );
    await convexFixture(
      rootDir,
      "http/domains/moneyMovement/routes/mtnMomo.ts",
      `
        import { Hono } from "hono";
        import { HonoWithConvex } from "convex-helpers/server/hono";
        const mtnMomoRoutes: HonoWithConvex<any> = new Hono();
        mtnMomoRoutes.on(["POST", "PUT"], "/collections", async (c) => c.json({}));
        export { mtnMomoRoutes };
      `,
    );
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { bagRoutes } from "./http/domains/customerChannel/routes/bag";
        import { mtnMomoRoutes } from "./http/domains/moneyMovement/routes/mtnMomo";
        app.route("/bags", bagRoutes);
        app.route("/webhooks/mtn-momo", mtnMomoRoutes);
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    expect(result.findings.map((finding) => finding.functionName).sort()).toEqual(
      [
        "POST /bags/:bagId/items",
        "POST /webhooks/mtn-momo/collections",
        "PUT /webhooks/mtn-momo/collections",
      ],
    );
    expect(
      result.ingress
        .filter((entry) => entry.kind === "http")
        .map((entry) => entry.route?.path)
        .sort(),
    ).toEqual([
      "/bags/:bagId/items",
      "/webhooks/mtn-momo/collections",
      "/webhooks/mtn-momo/collections",
    ]);
  });

  it("classifies a GET route as http_read and requires the read wrapper", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http/domains/core/routes/products.ts",
      `
        import { Hono } from "hono";
        import { HonoWithConvex } from "convex-helpers/server/hono";
        import { admitHttpRoute } from "../../../../platform/operationAdmission";
        import { def } from "../../../../operationAdmission/definitions";
        const productRoutes: HonoWithConvex<any> = new Hono();
        productRoutes.get("/", admitHttpRoute(def, async (c) => c.json({})));
        export { productRoutes };
      `,
    );
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { productRoutes } from "./http/domains/core/routes/products";
        app.route("/products", productRoutes);
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [
        {
          kind: "http_read",
          route: { method: "GET", path: "/products" },
          operationId: "http.products.list.read",
          capability: "catalog.view",
          access: { kind: "read", intent: "inventory.catalog.view" },
        },
      ],
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    expect(result.findings.map((finding) => finding.id)).toContain(
      "admission-wrapper-kind-mismatch-get-products",
    );
  });

  it("verifies FRAMEWORK_ENTRY_POINTS in both directions", async () => {
    const missingRoot = await createFixtureRoot();
    await convexFixture(missingRoot, "http.ts", ADMITTED_ROUTER);
    await convexFixture(
      missingRoot,
      "auth.ts",
      `
        import { convexAuth } from "@convex-dev/auth/server";
        export const { auth, signIn } = convexAuth({ providers: [] });
      `,
    );
    const missing = await collectOperationAdmissionCheckResult(missingRoot, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });
    expect(missing.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "framework-entry-point-not-discovered-auth-signout",
        "framework-entry-point-not-discovered-auth-store",
      ]),
    );

    const extraRoot = await createFixtureRoot();
    await convexFixture(extraRoot, "http.ts", ADMITTED_ROUTER);
    await convexFixture(
      extraRoot,
      "auth.ts",
      `
        import { convexAuth } from "@convex-dev/auth/server";
        export const { auth, signIn, signOut, store, impersonate } = convexAuth({ providers: [] });
      `,
    );
    const extra = await collectOperationAdmissionCheckResult(extraRoot, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });
    expect(extra.findings.map((finding) => finding.id)).toContain(
      "unlisted-framework-registrar-export-auth-impersonate",
    );
  });

  it("requires auth.addHttpRoutes to be registered exactly once from http.ts", async () => {
    const rootDir = await createFixtureRoot();
    await convexFixture(rootDir, "auth.ts", AUTH_MODULE);
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        auth.addHttpRoutes(http);
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    expect(result.findings.map((finding) => finding.id)).toContain(
      "auth-http-route-family-not-registered-once",
    );
  });

  it("bans api.* self-calls reached through an alias", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http/domains/customerChannel/routes/bag.ts",
      `
        import { api } from "../../../../_generated/api";
        const bagApi = api.storeFront.bag;
        export async function loadBag(ctx) {
          return ctx.runQuery(bagApi.getByUserId, { storeFrontUserId: "x" });
        }
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    const selfCall = result.findings.filter((finding) =>
      finding.id.startsWith("api-self-call-"),
    );
    expect(selfCall).toHaveLength(1);
    expect(selfCall[0].functionName).toBe("bagApi.getByUserId");
  });

  it("flags a reflect-any-origin CORS middleware on the router", async () => {
    const rootDir = await createFixtureRoot();
    await convexFixture(rootDir, "auth.ts", AUTH_MODULE);
    await convexFixture(
      rootDir,
      "http.ts",
      ADMITTED_ROUTER.replace(
        "cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true })",
        "cors({ origin: (origin) => origin, credentials: true })",
      ),
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    expect(result.findings.map((finding) => finding.id)).toContain(
      "router-cors-origin-not-allowlisted",
    );
  });

  it("does not report an action-targeting definition as stale, but does report a truly stale one", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "storeFront/reviews.ts",
      `
        import { action } from "../_generated/server";
        import { admitPublicAction } from "../platform/operationAdmission";
        import { def } from "../operationAdmission/definitions";
        export const sendFeedbackRequest = action({
          args: {},
          handler: admitPublicAction(def, async () => null),
        });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [
        {
          kind: "action",
          functionName: "storeFront/reviews:sendFeedbackRequest",
          operationId: "storeFront.reviews.sendFeedbackRequest",
          capability: "customer_message.send",
        },
        {
          kind: "mutation",
          functionName: "storeFront/reviews:deletedLongAgo",
          operationId: "storeFront.reviews.deletedLongAgo",
          capability: "reviews.manage",
        },
      ],
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    expect(result.findings.map((finding) => finding.id)).toEqual([
      "stale-operation-definition-storefront-reviews-deletedlongago",
    ]);
  });

  it("reports a definition without its wrapper separately from an undeclared ingress", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "inventory/products.ts",
      `
        import { mutation } from "../_generated/server";
        export const create = mutation({ args: {}, handler: async () => null });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [
        {
          kind: "mutation",
          functionName: "inventory/products:create",
          operationId: "inventory.products.create",
          capability: "catalog.manage",
        },
      ],
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    expect(result.findings.map((finding) => finding.id)).toEqual([
      "definition-without-admission-wrapper-inventory-products-create",
    ]);
  });

  it("filters findings by --path prefix", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "inventory/products.ts",
      `
        import { mutation } from "../_generated/server";
        export const create = mutation({ args: {}, handler: async () => null });
      `,
    );
    await convexFixture(
      rootDir,
      "pos/public/sync.ts",
      `
        import { mutation } from "../../_generated/server";
        export const sync = mutation({ args: {}, handler: async () => null });
      `,
    );

    const all = await collectOperationAdmissionCheckResult(rootDir, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });
    expect(all.findings).toHaveLength(2);

    const scoped = await collectOperationAdmissionCheckResult(rootDir, {
      readDefinitions: [HEALTH_READ_DEFINITION],
      paths: ["pos/public/"],
    });
    expect(scoped.findings.map((finding) => finding.functionName)).toEqual([
      "pos/public/sync:sync",
    ]);
  });

  it("reports an orphan file that no ownership row claims", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "brandNewDomain/public.ts",
      `
        import { mutation } from "../_generated/server";
        export const write = mutation({ args: {}, handler: async () => null });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    expect(result.orphanFiles).toEqual(["brandNewDomain/public.ts"]);
    expect(formatPartitionReport(result)).toContain("brandNewDomain/public.ts");
  });

  it("builds a caller table with id-arg provenance and dispositions", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http/domains/customerChannel/routes/bag.ts",
      `
        import { Hono } from "hono";
        import { HonoWithConvex } from "convex-helpers/server/hono";
        import { api, internal } from "../../../../_generated/api";
        const bagRoutes: HonoWithConvex<any> = new Hono();
        bagRoutes.post("/:bagId/items", async (c) => {
          await c.env.runQuery(api.storeFront.bag.getByUserId, { storeFrontUserId: userId });
          await c.env.runMutation(internal.storeFront.bagItem.addItemToBag, {
            bagId: c.env.operationAdmission.actor.storeFrontUserId,
          });
          return c.json({});
        });
        export { bagRoutes };
      `,
    );
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { bagRoutes } from "./http/domains/customerChannel/routes/bag";
        app.route("/bags", bagRoutes);
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    const rows = result.callerTable.filter(
      (row) => row.ingressId === "POST /bags/:bagId/items",
    );
    expect(rows).toHaveLength(2);
    const publicRow = rows.find((row) => row.calleeRoot === "api");
    expect(publicRow?.disposition).toBe("internalize");
    expect(publicRow?.idArgs).toEqual([
      { name: "storeFrontUserId", source: "client-supplied" },
    ]);
    const internalRow = rows.find((row) => row.calleeRoot === "internal");
    expect(internalRow?.disposition).toBe("already-internal");
    expect(internalRow?.idArgs).toEqual([
      { name: "bagId", source: "admitted-actor" },
    ]);
    expect(formatCallerTable(result.callerTable)).toContain(
      "| Ingress | Kind | Site | Callee | Root | Id args (source) | Disposition |",
    );
  });

  it("lists internal mutations reachable from a demo-admitted action, through helpers", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "storeFront/helpers/orderUpdateEmails.ts",
      `
        import { internal } from "../../_generated/api";
        export async function processOrderUpdateEmail(ctx, args) {
          await ctx.runMutation(internal.storeFront.onlineOrder.updateInternal, { id: args.orderId });
        }
      `,
    );
    await convexFixture(
      rootDir,
      "storeFront/onlineOrder.ts",
      `
        import { internalMutation } from "../_generated/server";
        export const updateInternal = internalMutation({ args: {}, handler: async () => null });
      `,
    );
    await convexFixture(
      rootDir,
      "storeFront/onlineOrderUtilFns.ts",
      `
        import { action } from "../_generated/server";
        import { admitPublicAction } from "../platform/operationAdmission";
        import { def } from "../operationAdmission/definitions";
        import { processOrderUpdateEmail } from "./helpers/orderUpdateEmails";

        export const sendOrderUpdateEmail = action({
          args: {},
          handler: admitPublicAction(def, async (ctx, args) => {
            await processOrderUpdateEmail(ctx, args);
            return null;
          }),
        });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir, {
      operationDefinitions: [
        {
          kind: "action",
          functionName: "storeFront/onlineOrderUtilFns:sendOrderUpdateEmail",
          operationId: "storeFront.onlineOrderUtilFns.sendOrderUpdateEmail",
          capability: "order_notification.send",
          actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
        },
      ],
      readDefinitions: [HEALTH_READ_DEFINITION],
    });

    expect(result.downstreamWrites).toEqual([
      {
        ingressId: "storeFront/onlineOrderUtilFns:sendOrderUpdateEmail",
        ingressKind: "action",
        operationId: "storeFront.onlineOrderUtilFns.sendOrderUpdateEmail",
        internalMutation: "internal.storeFront.onlineOrder.updateInternal",
        depth: 1,
      },
    ]);
    expect(formatDownstreamWrites(result.downstreamWrites)).toContain(
      "internal.storeFront.onlineOrder.updateInternal",
    );
  });
});

describe("runCli", () => {
  it("exits 0 on a clean tree and writes the generated artifacts on demand", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await writeDefinitionModules(rootDir, [], [HEALTH_READ_DEFINITION]);

    const exitCode = await runCli(rootDir, [
      "--partition",
      "--callers",
      "--downstream-writes",
    ]);

    expect(exitCode).toBe(0);
    await expect(
      readFile(
        path.join(rootDir, "docs/plans/2026-08-16-002-backend-caller-table.md"),
        "utf8",
      ),
    ).resolves.toContain("# Backend caller table");
    await expect(
      readFile(
        path.join(rootDir, "docs/plans/2026-08-16-002-downstream-writes.md"),
        "utf8",
      ),
    ).resolves.toContain("# Downstream internal writes");
  });

  it("exits 1 on findings and on orphan files", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await writeDefinitionModules(rootDir, [], [HEALTH_READ_DEFINITION]);
    await convexFixture(
      rootDir,
      "brandNewDomain/public.ts",
      `
        import { mutation } from "../_generated/server";
        export const write = mutation({ args: {}, handler: async () => null });
      `,
    );

    expect(await runCli(rootDir, [])).toBe(1);
    expect(await runCli(rootDir, ["--partition"])).toBe(1);
  });
});

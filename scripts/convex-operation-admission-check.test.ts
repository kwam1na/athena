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

  /**
   * The wrapper grammar is a WHITELIST, and these fixtures are the reason.
   *
   * Three consecutive review rounds defeated the previous blacklist, each with
   * a shape it had not enumerated. Every one of those shapes is pinned here as
   * a negative, alongside a positive control for every shape the repository
   * actually uses today — so the grammar can never be loosened to re-admit an
   * escape, and can never be tightened past what the codebase is written in.
   */
  describe("wrapper grammar", () => {
    const PROLOGUE = `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../platform/operationAdmission";
        import { definition } from "../operationAdmission/definitions";
    `;

    /** One ingress in a module that imports the real composition root. */
    const module = (body: string) =>
      collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/grammar.ts",
        `${PROLOGUE}\n${body}`,
      )[0];

    /** An inline `handler:` body, wrapped in the outer arrow under test. */
    const handler = (expression: string) =>
      module(`export const write = mutation({
          args: {},
          handler: ${expression},
        });`);

    // -- positive controls: every shape the repository uses today -----------

    describe("accepted shapes", () => {
      it("accepts the direct application with an inline arrow handler", () => {
        // 562 sites, the dominant repository shape.
        const entry = handler(
          `admitPublicMutation(definition, async (ctx, args) => {
             const row = await ctx.db.get(args.id);
             await ctx.db.insert("auditLog", { row });
             return ctx.runMutation(internal.some.write, {});
           })`,
        );
        expect(entry.admitted).toBe(true);
        expect(entry.wrapperShape).toBeUndefined();
        expect(entry.wrapperOffComposition).toBe(false);
      });

      it("accepts the direct application with a named handler identifier", () => {
        // 21 sites, including both `.on`-form money-movement routes.
        const entry = handler(
          "admitPublicMutation(definition, importInventoryCommandWithCtx)",
        );
        expect(entry.admitted).toBe(true);
        expect(entry.wrapperShape).toBeUndefined();
      });

      it("accepts a dotted member expression as the definition", () => {
        const entry = handler(
          "admitPublicMutation(definitions.inventory.import, handlerFn)",
        );
        expect(entry.admitted).toBe(true);
        expect(entry.wrapperShape).toBeUndefined();
      });

      it("accepts a top-level const bound to the application", () => {
        // 7 sites, e.g. stockOps/cycleCountDrafts.ts.
        const entry = module(
          `const admittedHandler = admitPublicMutation(definition, async () => null);

           export const write = mutation({ args: {}, handler: admittedHandler });`,
        );
        expect(entry.admitted).toBe(true);
        expect(entry.wrapperShape).toBeUndefined();
      });

      it("accepts the denial-mapping try around a direct application", () => {
        // 13 sites, e.g. convex/notifications/subscriptions.ts. The catch is
        // the only place a denial THROWN BY the wrapper can be mapped, which is
        // why this is the one wrapping function the grammar accepts.
        const entry = handler(
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, commandWithCtx)(ctx, args);
             } catch (error) {
               const mapped = mapSharedDemoFoundationDenial(error);
               if (mapped) return mapped;
               throw error;
             }
           }`,
        );
        expect(entry.admitted).toBe(true);
        expect(entry.wrapperShape).toBeUndefined();
      });

      it("accepts the denial-mapping try around a const-bound application", () => {
        // e.g. convex/inventory/athenaUser.ts and openWorkInventoryReviews.ts.
        const entry = module(
          `const admittedHandler = admitPublicMutation(definition, async () => null);

           export const write = mutation({
             args: {},
             handler: async (ctx, args) => {
               try {
                 return await admittedHandler(ctx, args);
               } catch (error) {
                 if (isExpiredSharedDemoSessionError(error)) return null;
                 throw error;
               }
             },
           });`,
        );
        expect(entry.admitted).toBe(true);
        expect(entry.wrapperShape).toBeUndefined();
      });

      it("accepts a type-annotated parameter list on the denial-mapping try", () => {
        // convex/inventory/athenaUser.ts annotates the args parameter.
        const entry = handler(
          `async (ctx, args: Record<string, never>) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, args);
             } catch (error) { throw error; }
           }`,
        );
        expect(entry.admitted).toBe(true);
      });

      it("accepts a namespace import of the composition root itself", () => {
        const entry = collectConvexIngressFromSource(
          "packages/athena-webapp/convex/example/nsRoot.ts",
          `
            import { mutation } from "../_generated/server";
            import * as admission from "../platform/operationAdmission";
            import { definition } from "../operationAdmission/definitions";

            export const write = mutation({
              args: {},
              handler: admission.admitPublicMutation(definition, async () => null),
            });
          `,
        )[0];
        expect(entry.admitted).toBe(true);
        expect(entry.wrapperOffComposition).toBe(false);
      });
    });

    // -- composition-root identity: round 3, P0 ----------------------------

    /**
     * Identity used to be an unresolved path SUFFIX, so any module at a path
     * ending in `platform/operationAdmission` — or a package specifier that
     * merely spelled it — passed as the rail. A local shim could stand the rail
     * down file by file while the checker reported zero findings, which is the
     * exemption construct this contract exists to remove. The specifier is now
     * RESOLVED against the importing file and compared to the one canonical
     * path.
     */
    describe("composition-root identity is a resolved path, not a suffix", () => {
      const shimmed = (specifier: string, form: "named" | "namespace") =>
        collectConvexIngressFromSource(
          "packages/athena-webapp/convex/x/attack.ts",
          form === "named"
            ? `
              import { mutation } from "../_generated/server";
              import { admitPublicMutation } from "${specifier}";
              import { definition } from "../operationAdmission/definitions";

              export const write = mutation({
                args: {},
                handler: admitPublicMutation(definition, async () => null),
              });
            `
            : `
              import { mutation } from "../_generated/server";
              import * as rail from "${specifier}";
              import { definition } from "../operationAdmission/definitions";

              export const write = mutation({
                args: {},
                handler: rail.admitPublicMutation(definition, async () => null),
              });
            `,
        )[0];

      it.each([
        ["a sibling shim directory", "./local/platform/operationAdmission"],
        ["a shim reached by parent traversal", "../a/platform/operationAdmission"],
        ["a package specifier", "@evil/platform/operationAdmission"],
        ["a bare specifier", "platform/operationAdmission"],
      ])("rejects %s as the composition root (named import)", (_label, specifier) => {
        const entry = shimmed(specifier, "named");
        // Recognized by name, so it raises its own off-composition finding
        // rather than vanishing into "no wrapper at all".
        expect(entry.wrapperOffComposition).toBe(true);
      });

      it.each([
        ["a sibling shim directory", "./local/platform/operationAdmission"],
        ["a shim reached by parent traversal", "../a/platform/operationAdmission"],
        ["a package specifier", "@evil/platform/operationAdmission"],
      ])("rejects %s as the composition root (namespace import)", (_label, specifier) => {
        const entry = shimmed(specifier, "namespace");
        // A method on a non-root namespace is not a wrapper at all.
        expect(entry.admitted).toBe(false);
      });

      it("accepts the real composition root through both import forms", () => {
        expect(shimmed("../platform/operationAdmission", "named").admitted).toBe(
          true,
        );
        expect(
          shimmed("../platform/operationAdmission", "named").wrapperOffComposition,
        ).toBe(false);
        expect(
          shimmed("../platform/operationAdmission", "namespace").admitted,
        ).toBe(true);
      });

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
              handler: shim.admitPublicMutation(definition, async () => null),
            });
          `,
        );
        expect(ingress.map((entry) => [entry.id, entry.admitted])).toEqual([
          ["example/shim:real", true],
          ["example/shim:shimmed", false],
        ]);
      });

      it("does not recognize the retired pre-rename wrapper alias names", () => {
        const entry = collectConvexIngressFromSource(
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
        )[0];
        expect(entry.admitted).toBe(false);
      });
    });

    // -- negatives: one per adversarial shape from all three rounds ---------

    /**
     * Each entry is a shape that defeated a previous round of the checker, or
     * a near neighbour of one. The grammar rejects them all by construction —
     * not because each is enumerated, but because none of them is one of the
     * three accepted shapes.
     */
    describe("rejected shapes", () => {
      it.each([
        // Round 1: a declaration is not an invocation.
        [
          "a const-bound wrapper declared, then work, then invoked",
          `async (ctx, args) => {
             const run = admitPublicMutation(definition, async () => null);
             await ctx.db.insert("auditLog", {});
             return run(ctx, args);
           }`,
        ],
        [
          "a hoisted wrapper invoked after other work",
          `async (ctx, args) => {
             const existing = await ctx.db.get(args.id);
             return admitPublicMutation(definition, fn)(ctx, args);
           }`,
        ],
        // Round 2: pre-admission work in the argument lists.
        [
          "an awaited read in the applied argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, { ...args, row: await ctx.db.get(args.id) });
             } catch (error) { throw error; }
           }`,
        ],
        [
          "an awaited handler build in the wrapper's own argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, await buildHandler(ctx))(ctx, args);
             } catch (error) { throw error; }
           }`,
        ],
        [
          "an unawaited ctx.runMutation in the applied argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, { probe: ctx.runMutation(internal.some.write, {}) });
             } catch (error) { throw error; }
           }`,
        ],
        // Round 3, P0: an IIFE runs before admission.
        [
          "a synchronous IIFE in the applied argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, ((): any => { ctx.db.insert("t", args); return args; })());
             } catch (error) { throw error; }
           }`,
        ],
        [
          "an async IIFE awaiting a read in the applied argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, (async () => await ctx.db.get(args.id))());
             } catch (error) { throw error; }
           }`,
        ],
        [
          "an IIFE scheduling work in the applied argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, ((): any => { ctx.scheduler.runAfter(0, internal.a.b, args); return args; })());
             } catch (error) { throw error; }
           }`,
        ],
        // Round 3, P1: receivers the old predicate could not see.
        [
          "a computed ctx[\"db\"] receiver in the applied argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, { ...args, x: ctx["db"].insert("t", args) });
             } catch (error) { throw error; }
           }`,
        ],
        [
          "a computed ctx.db[\"insert\"] method in the applied argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, { ...args, x: ctx.db["insert"]("t", args) });
             } catch (error) { throw error; }
           }`,
        ],
        [
          "a parenthesized (ctx).runMutation in the applied argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, { x: (ctx).runMutation(internal.a.b, {}) });
             } catch (error) { throw error; }
           }`,
        ],
        [
          "a db destructured off the handler's ctx parameter",
          `async ({ db, ...ctx }, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx as any, { ...args, x: db.insert("t", args) });
             } catch (error) { throw error; }
           }`,
        ],
        // Round 3, P2: parameter defaults run before the body.
        [
          "a handler parameter default doing work",
          `async (ctx, args, pre = ctx.db.insert("t", args)) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, args);
             } catch (error) { throw error; }
           }`,
        ],
        [
          "a handler parameter default that merely reads",
          `async (ctx, args, row = ctx.db.get(args.id)) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, args);
             } catch (error) { throw error; }
           }`,
        ],
        // Operators that sequence work into an argument position.
        [
          "a comma operator in the applied argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, (ctx.db.insert("t", args), args));
             } catch (error) { throw error; }
           }`,
        ],
        [
          "a conditional expression in the wrapper's argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, args.x ? fn : other)(ctx, args);
             } catch (error) { throw error; }
           }`,
        ],
        [
          "a logical operator in the wrapper's argument list",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition || fallbackDefinition, fn)(ctx, args);
             } catch (error) { throw error; }
           }`,
        ],
        [
          "a spread in the wrapper's argument list",
          "admitPublicMutation(...wrapperArguments)",
        ],
        // Wrapping shapes other than the denial-mapping try.
        [
          "a concise arrow wrapping the wrapper",
          "async (ctx, args) => admitPublicMutation(definition, fn)(ctx, args)",
        ],
        [
          "a block arrow returning the wrapper without a denial-mapping try",
          `async (ctx, args) => { return admitPublicMutation(definition, fn)(ctx, args); }`,
        ],
        [
          "the wrapper nested in a branch",
          `async (ctx, args) => {
             if (args.mode === "admit") {
               return admitPublicMutation(definition, fn)(ctx, args);
             }
             return null;
           }`,
        ],
        [
          "a try whose block does work before the wrapper",
          `async (ctx, args) => {
             try {
               const row = await ctx.db.get(args.id);
               return await admitPublicMutation(definition, fn)(ctx, args);
             } catch (error) { throw error; }
           }`,
        ],
        [
          "a try whose invocation forwards a rebuilt args object",
          `async (ctx, args) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, { ...args });
             } catch (error) { throw error; }
           }`,
        ],
        [
          "an extra argument on the wrapper",
          "admitPublicMutation(definition, fn, { bypass: true })",
        ],
        [
          "a single argument on the wrapper",
          "admitPublicMutation(definition)",
        ],
        [
          "an optional-chained wrapper invocation",
          "admitPublicMutation?.(definition, fn)",
        ],
        [
          "a wrapper reached through a property access on a non-root receiver",
          "helpers.admitPublicMutation(definition, fn)",
        ],
      ])("rejects %s", (_label, expression) => {
        const entry = handler(expression);
        expect(entry.admitted).toBe(false);
      });

      /**
       * A rejected shape must SAY which shapes are accepted, so the fix never
       * requires reading the checker.
       */
      it("explains the accepted shapes on every shape rejection", () => {
        const entry = handler(
          `async (ctx, args, pre = ctx.db.insert("t", args)) => {
             try {
               return await admitPublicMutation(definition, fn)(ctx, args);
             } catch (error) { throw error; }
           }`,
        );
        expect(entry.wrapperShape).toContain("default value");
      });

      /**
       * A shape violation and a missing wrapper need different remediation, so
       * a handler with no wrapper at all must NOT carry a shape reason.
       */
      it("reports no wrapper at all without a shape reason", () => {
        const entry = handler(
          `async (ctx, args) => { return await someOtherHelper(ctx, args); }`,
        );
        expect(entry.admitted).toBe(false);
        expect(entry.wrapperShape).toBeUndefined();
      });

      /**
       * A const bound to a MALFORMED application is not a wrapper, and using it
       * carries the binding site's reason rather than looking like a plain
       * missing wrapper.
       */
      it("does not admit a const bound to a malformed application", () => {
        const entry = module(
          `const admittedHandler = admitPublicMutation(definition, await buildHandler());

           export const write = mutation({ args: {}, handler: admittedHandler });`,
        );
        expect(entry.admitted).toBe(false);
        expect(entry.wrapperShape).toContain("second argument");
      });

      /**
       * The negative control for the whole grammar: everything inside the
       * admitted handler runs AFTER admission, so no amount of ctx effects
       * there may reject the ingress. A rule that descended into it would
       * reject every correctly admitted ingress in the repository.
       */
      it("still accepts arbitrary ctx effects inside the admitted handler", () => {
        const entry = handler(
          `admitPublicMutation(definition, async (ctx, args) => {
             const row = await ctx.db.get(args.id);
             await ctx.db.insert("auditLog", { row });
             await ctx.scheduler.runAfter(0, internal.a.b, args);
             return ctx.runMutation(internal.some.write, {});
           })`,
        );
        expect(entry.admitted).toBe(true);
        expect(entry.wrapperShape).toBeUndefined();
      });
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

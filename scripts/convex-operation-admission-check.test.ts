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

type NamedDefinitions = Record<string, unknown>;

/**
 * Real definition modules on disk, exporting each definition BY NAME and
 * composing them into the registry arrays the loader reads. Fixture ingress
 * imports these names, so the checker resolves the wrapper's definition
 * argument through the same import-and-evaluate path the gate uses; a
 * fixture that hands the wrapper the wrong const is caught exactly like the
 * real tree would be.
 */
async function writeDefinitionModules(
  rootDir: string,
  writes: NamedDefinitions,
  reads: NamedDefinitions,
) {
  const render = (named: NamedDefinitions, registry: string) =>
    [
      ...Object.entries(named).map(
        ([name, definition]) =>
          `export const ${name} = ${JSON.stringify(definition)};`,
      ),
      `export const ${registry} = [${Object.keys(named).join(", ")}];`,
      "",
    ].join("\n");
  await convexFixture(
    rootDir,
    "operationAdmission/definitions.ts",
    render(writes, "OPERATION_ADMISSION_DEFINITIONS"),
  );
  await convexFixture(
    rootDir,
    "operationAdmission/readDefinitions.ts",
    render(
      { healthReadDefinition: HEALTH_READ_DEFINITION, ...reads },
      "OPERATION_READ_ADMISSION_DEFINITIONS",
    ),
  );
}

/**
 * auth.ts + the admitted router + definition modules. `writes` / `reads` are
 * the extra named definitions a fixture's ingress imports; the health read the
 * router registers is always present.
 */
async function writeBaselineTree(
  rootDir: string,
  definitions: { writes?: NamedDefinitions; reads?: NamedDefinitions } = {},
) {
  await convexFixture(rootDir, "auth.ts", AUTH_MODULE);
  await convexFixture(rootDir, "http.ts", ADMITTED_ROUTER);
  await writeDefinitionModules(
    rootDir,
    definitions.writes ?? {},
    definitions.reads ?? {},
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
       * Round 4, P1: the denial-mapping catch runs for a caller the wrapper
       * has just DENIED — the denial is what lands in it — with the outer
       * `ctx` / `args` in scope. So catch and finally are pinned too: they
       * may not mention an outer parameter, `this`, or `arguments`, and every
       * callee in them must be a plain identifier or dotted member.
       */
      describe("denial-mapping catch and finally clauses", () => {
        it.each([
          [
            "a catch that runs the handler for the denied caller",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 return await fn(ctx, args);
               }
             }`,
            "catch clause references the outer handler's `ctx`",
          ],
          [
            "a catch that writes with the outer ctx",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 await ctx.db.insert("t", args);
                 return await fn(ctx, args);
               }
             }`,
            "catch clause references the outer handler's `ctx`",
          ],
          [
            "a catch that only reads args",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 return { ok: false, id: args.id };
               }
             }`,
            "catch clause references the outer handler's `args`",
          ],
          [
            "a finally that writes with the outer ctx",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 throw error;
               } finally {
                 await ctx.db.insert("t", args);
               }
             }`,
            "finally clause references the outer handler's `ctx`",
          ],
          [
            "a finally with no catch that writes with the outer ctx",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } finally {
                 await ctx.db.insert("t", args);
               }
             }`,
            "finally clause references the outer handler's `ctx`",
          ],
          [
            "a catch shorthand property that smuggles args out",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 return sink({ args });
               }
             }`,
            "catch clause references the outer handler's `args`",
          ],
          [
            "a catch calling an IIFE",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 return (() => mapDenial(error))();
               }
             }`,
            "catch clause calls",
          ],
          [
            "a catch calling through a computed callee",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 return handlers["map"](error);
               }
             }`,
            "catch clause calls",
          ],
          [
            "a catch reading arguments",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 return recover(arguments);
               }
             }`,
            "catch clause reads `arguments`",
          ],
        ])("rejects %s", (_label, expression, reason) => {
          const entry = handler(expression);
          expect(entry.admitted).toBe(false);
          expect(entry.wrapperShape).toContain(reason);
        });

        it.each([
          [
            "the subscriptions shape: map the typed denial, else rethrow",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 const mapped = mapSharedDemoFoundationDenial(error);
                 if (mapped) return mapped;
                 throw error;
               }
             }`,
          ],
          [
            "the deposits / dailyClose shape: predicate on error, userError({...})",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 if (!isDepositAdmissionAuthorizationError(error)) {
                   throw error;
                 }
                 return userError({
                   code: "authorization_failed",
                   message: "You do not have access to cash controls.",
                 });
               }
             }`,
          ],
          [
            "the staffCredentials shape: message extraction and comparison",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 const message = error instanceof Error ? error.message : "";
                 if (message === "Sign in again to continue.") {
                   return userError({ code: "authorization_failed", message });
                 }
                 throw error;
               }
             }`,
          ],
          [
            "a catch that mentions `ctx` only as a property name",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 return userError({ ctx: "denied", args: error.args, code: error.details.ctx });
               }
             }`,
          ],
          [
            "an error-only finally",
            `async (ctx, args) => {
               try {
                 return await admitPublicMutation(definition, fn)(ctx, args);
               } catch (error) {
                 throw error;
               } finally {
                 recordDenialMetric();
               }
             }`,
          ],
        ])("still accepts %s", (_label, expression) => {
          const entry = handler(expression);
          expect(entry.admitted).toBe(true);
          expect(entry.wrapperShape).toBeUndefined();
        });
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

  /**
   * Round 4, P1: discovery used to accept only `export const x = <builder>(...)`
   * with a literal CallExpression initializer and `export default <call>`.
   * Every other spelling Convex registers was not "unadmitted", it was
   * invisible. Discovery now resolves the spellings below, and any exported
   * binding that mentions a builder but is not one of them is reported as
   * `notStaticallyResolvable` — an unknown spelling is a failure, not a pass.
   */
  describe("discovery is fail-closed over export spellings", () => {
    const discover = (body: string, imports = `import { mutation, query } from "../_generated/server";`) =>
      collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/x.ts",
        `${imports}\n${body}`,
      );

    it.each([
      [
        "an `as` cast around the builder call",
        `export const a = mutation({ args: {}, handler: async () => null }) as any;`,
        "example/x:a",
        "mutation",
      ],
      [
        "a `satisfies` around the builder call",
        `export const a = mutation({ args: {}, handler: async () => null }) satisfies X;`,
        "example/x:a",
        "mutation",
      ],
      [
        "a non-null assertion around the builder call",
        `export const a = mutation({ args: {}, handler: async () => null })!;`,
        "example/x:a",
        "mutation",
      ],
      [
        "a parenthesized builder callee",
        `export const a = (mutation)({ args: {}, handler: async () => null });`,
        "example/x:a",
        "mutation",
      ],
      [
        "a local const exported by name",
        `const a = mutation({ args: {}, handler: async () => null });\nexport { a };`,
        "example/x:a",
        "mutation",
      ],
      [
        "a local const exported under another name",
        `const a = query({ args: {}, handler: async () => null });\nexport { a as b };`,
        "example/x:b",
        "query",
      ],
      [
        "a local const as the default export",
        `const a = mutation({ args: {}, handler: async () => null });\nexport default a;`,
        "example/x:default",
        "mutation",
      ],
      [
        "a cast default export",
        `export default mutation({ args: {}, handler: async () => null }) as any;`,
        "example/x:default",
        "mutation",
      ],
    ])("discovers %s", (_label, body, id, kind) => {
      const ingress = discover(body);
      expect(ingress.map((entry) => [entry.id, entry.kind, entry.admitted])).toEqual([
        [id, kind, false],
      ]);
      expect(ingress[0].notStaticallyResolvable).toBeUndefined();
    });

    it("discovers destructured object-literal exports element by element", () => {
      const ingress = discover(
        `export const { a, b: c } = { a: mutation({ args: {}, handler: async () => null }), b: query({ args: {}, handler: async () => null }) };`,
      );
      expect(ingress.map((entry) => [entry.id, entry.kind])).toEqual([
        ["example/x:a", "mutation"],
        ["example/x:c", "query"],
      ]);
      expect(ingress.every((entry) => !entry.notStaticallyResolvable)).toBe(true);
    });

    it("recognizes the generic builders from convex/server, named and namespaced", () => {
      const ingress = discover(
        `export const a = mutationGeneric({ args: {}, handler: async () => null });
         export const b = queryGeneric({ args: {}, handler: async () => null });
         export const c = convexServer.actionGeneric({ args: {}, handler: async () => null });`,
        `import { mutationGeneric, queryGeneric } from "convex/server";\nimport * as convexServer from "convex/server";`,
      );
      expect(ingress.map((entry) => [entry.id, entry.kind])).toEqual([
        ["example/x:a", "mutation"],
        ["example/x:b", "query"],
        ["example/x:c", "action"],
      ]);
    });

    it("recognizes _generated/server under a .js specifier", () => {
      const ingress = discover(
        `export const a = mutation({ args: {}, handler: async () => null });`,
        `import { mutation } from "../_generated/server.js";`,
      );
      expect(ingress.map((entry) => entry.id)).toEqual(["example/x:a"]);
    });

    it("admits a discovered non-bare spelling exactly like a bare one", () => {
      const ingress = discover(
        `const a = mutation({ args: {}, handler: admitPublicMutation(definition, async () => null) });
         export { a as write };`,
        `import { mutation } from "../_generated/server";
         import { admitPublicMutation } from "../platform/operationAdmission";
         import { definition } from "../operationAdmission/definitions";`,
      );
      expect(ingress.map((entry) => [entry.id, entry.admitted])).toEqual([
        ["example/x:write", true],
      ]);
      expect(ingress[0].definitionReference).toEqual({ root: "definition", path: [] });
    });

    it.each([
      [
        "a conditional initializer",
        `export const a = flag ? mutation({ args: {}, handler: async () => null }) : query({ args: {}, handler: async () => null });`,
        "example/x:a",
      ],
      [
        "a builder call wrapped in another call",
        `export const a = wrap(mutation({ args: {}, handler: async () => null }));`,
        "example/x:a",
      ],
      [
        "a builder call behind a logical operator",
        `export const a = existing || mutation({ args: {}, handler: async () => null });`,
        "example/x:a",
      ],
      [
        "a destructured export whose value is not a plain builder property",
        `export const { a } = build({ a: mutation({ args: {}, handler: async () => null }) });`,
        "example/x:a",
      ],
      [
        "a default export computed from a builder",
        `export default pick(mutation({ args: {}, handler: async () => null }));`,
        "example/x:default",
      ],
      [
        "a local const with a conditional builder initializer exported by name",
        `const a = flag ? mutation({ args: {}, handler: async () => null }) : other;\nexport { a };`,
        "example/x:a",
      ],
    ])("reports %s as not statically resolvable", (_label, body, id) => {
      const ingress = discover(body);
      expect(ingress.map((entry) => [entry.id, entry.admitted])).toEqual([[id, false]]);
      expect(ingress[0].notStaticallyResolvable).toMatch(/builder/);
    });

    it("does not mistake a `.query` property or a shadowing local for the builder", () => {
      const ingress = discover(
        `export const helper = { query: 1 };
         export const rows = async (ctx) => ctx.db.query("t").collect();
         export const hidden = internalQuery({ args: {}, handler: async (ctx) => ctx.db.query("t").collect() });
         export const KIND = { kind: "sku_mix", query: undefined };`,
        `import { query, internalQuery } from "../_generated/server";`,
      );
      expect(ingress).toEqual([]);
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

  /**
   * Round 4, P2: the ban is over public-function REFERENCES, not over the
   * spelling `api.`. Every first-class Convex spelling that resolves a public
   * function is a root, a computed index on a root fails closed, and an object
   * literal holding a reference widens to the whole object.
   */
  describe("roots beyond the generated `api` object", () => {
    const sites = (source: string, publicFunctionNames?: Set<string>) =>
      collectApiSelfCallSites(
        "packages/athena-webapp/convex/example/roots.ts",
        source,
        publicFunctionNames ? { publicFunctionNames } : {},
      );

    it("matches _generated/api under a .js specifier", () => {
      expect(
        sites(`
          import { api } from "../_generated/api.js";
          export async function run(ctx) { await ctx.runMutation(api.a.b, {}); }
        `).map((site) => site.reference),
      ).toEqual(["api.a.b"]);
    });

    it("treats anyApi from convex/server as a root, named and namespaced", () => {
      expect(
        sites(`
          import { anyApi } from "convex/server";
          import * as convexServer from "convex/server";
          export async function run(ctx) {
            await ctx.runMutation(anyApi.a.b, {});
            await ctx.runQuery(convexServer.anyApi.c.d, {});
          }
        `).map((site) => site.reference),
      ).toEqual(["anyApi.a.b", "convexServer.anyApi.c.d"]);
    });

    it("reports a computed index on an api root regardless of the index", () => {
      expect(
        sites(`
          import { api } from "../_generated/api";
          export async function run(ctx, name) { await ctx.runMutation(api.a[name], {}); }
        `).map((site) => site.reference),
      ).toEqual(["api.a[name]"]);
    });

    it("widens through an object literal holding a reference", () => {
      expect(
        sites(`
          import { api } from "../_generated/api";
          const refs = { m: api.a.b, other: 1 };
          export async function run(ctx) { await ctx.runMutation(refs.m, {}); }
        `).map((site) => site.reference),
      ).toEqual(["refs.m"]);
    });

    describe("makeFunctionReference", () => {
      const source = `
        import { makeFunctionReference } from "convex/server";
        const PUBLIC_REF = makeFunctionReference<"mutation">("storeFront/bag:create");
        const INTERNAL_REF = makeFunctionReference<"mutation">("storeFront/bag:createInternal");
        export async function run(ctx, name) {
          await ctx.runMutation(PUBLIC_REF, {});
          await ctx.runMutation(INTERNAL_REF, {});
          await ctx.scheduler.runAfter(0, makeFunctionReference<"action">(name), {});
          await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">(\`storeFront/bag:\${flag ? "createInternal" : "updateInternal"}\`), {});
        }
      `;

      it("is a site for every argument when the public surface is unknown", () => {
        expect(sites(source).map((site) => site.reference)).toEqual([
          "PUBLIC_REF",
          "INTERNAL_REF",
          "makeFunctionReference(name)",
          expect.stringContaining("makeFunctionReference(`storeFront/bag:"),
        ]);
      });

      it("is a site only when a statically enumerable name is public; a non-enumerable one always is", () => {
        expect(
          sites(source, new Set(["storeFront/bag:create"])).map((site) => site.reference),
        ).toEqual(["PUBLIC_REF", "makeFunctionReference(name)"]);
      });

      it("enumerates a template over a const-bound conditional, the real repo shape", () => {
        expect(
          sites(
            `
              import { makeFunctionReference } from "convex/server";
              export async function run(ctx, run) {
                const functionName = run.status === "applying" ? "processApplyBatch" : run.status === "undoing" ? "processUndoBatch" : null;
                if (!functionName) return;
                await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">(\`inventory/work:\${functionName}\`), {});
              }
            `,
            new Set(["inventory/work:public"]),
          ),
        ).toEqual([]);
        expect(
          sites(
            `
              import { makeFunctionReference } from "convex/server";
              export async function run(ctx, run) {
                const functionName = run.status === "applying" ? "processApplyBatch" : "public";
                await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">(\`inventory/work:\${functionName}\`), {});
              }
            `,
            new Set(["inventory/work:public"]),
          ).map((site) => site.via),
        ).toEqual(["runAfter"]);
      });
    });
  });
});

/** A router module prologue: `cors` from hono/cors, a Hono `app`, the allowlist import. */
const CORS_PROLOGUE = `
  import { Hono } from "hono";
  import { cors } from "hono/cors";
  import { STOREFRONT_ALLOWED_ORIGINS, readStorefrontOriginAllowlist } from "./platform/storefrontOrigins";
  const app = new Hono();
`;

describe("assertCorsAllowlist", () => {
  const cors = (body: string) =>
    assertCorsAllowlist(
      "packages/athena-webapp/convex/http.ts",
      `${CORS_PROLOGUE}\n${body}`,
    );

  /**
   * The origin grammar is a whitelist. Every value the real router and its
   * tests use is a positive control; every "not a callback, not '*'" escape
   * from the round-4 review is a negative.
   */
  describe("origin grammar", () => {
    it.each([
      [
        "the real router shape: an array literal spreading the allowlist reader",
        `app.use("*", cors({ origin: [...readStorefrontOriginAllowlist()], credentials: true }));`,
      ],
      [
        "an identifier imported from platform/storefrontOrigins",
        `app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true }));`,
      ],
      [
        "a zero-argument call to the allowlist reader",
        `app.use("*", cors({ origin: readStorefrontOriginAllowlist(), credentials: true }));`,
      ],
      [
        "an array literal of string literals",
        `app.use("*", cors({ origin: ["https://shop.example", "https://admin.example"] }));`,
      ],
    ])("accepts %s", (_label, body) => {
      const assertion = cors(body);
      expect(assertion.found).toBe(true);
      expect(assertion.allowlisted).toBe(true);
    });

    it.each([
      [
        "an identifier bound to a reflect callback",
        `const reflect = (o) => o;\napp.use("*", cors({ origin: reflect, credentials: true }));`,
      ],
      [
        "a member expression that is not an allowlist import",
        `app.use("*", cors({ origin: helpers.reflect, credentials: true }));`,
      ],
      [
        "an identifier from an unrelated module",
        `import { ORIGINS } from "./somewhere/else";\napp.use("*", cors({ origin: ORIGINS }));`,
      ],
      [
        "a call with arguments, even to the allowlist reader",
        `app.use("*", cors({ origin: readStorefrontOriginAllowlist(request) }));`,
      ],
      [
        "an array literal containing the wildcard",
        `app.use("*", cors({ origin: ["https://shop.example", "*"] }));`,
      ],
      [
        "an array literal spreading a non-allowlist value",
        `app.use("*", cors({ origin: [...extra] }));`,
      ],
    ])("rejects %s as not statically an allowlist", (_label, body) => {
      const assertion = cors(body);
      expect(assertion.found).toBe(true);
      expect(assertion.allowlisted).toBe(false);
      expect(assertion.detail).toContain("not statically an allowlist");
    });
  });

  it("never lets a later passing cors() call overwrite a failing one", () => {
    const assertion = cors(`
      app.use("*", cors({ origin: (o) => o, credentials: true }));
      const unused = cors({ origin: STOREFRONT_ALLOWED_ORIGINS });
    `);
    expect(assertion.allowlisted).toBe(false);
    expect(assertion.detail).toContain("called 2 times");
  });

  it("requires cors() to be the argument of <router>.use(...)", () => {
    const assertion = cors(`
      const middleware = cors({ origin: STOREFRONT_ALLOWED_ORIGINS });
      app.use("*", middleware);
    `);
    expect(assertion.allowlisted).toBe(false);
    expect(assertion.detail).toContain("<router>.use(...)");
  });

  it("requires cors to be imported from hono/cors", () => {
    const assertion = assertCorsAllowlist(
      "packages/athena-webapp/convex/http.ts",
      `
        import { Hono } from "hono";
        import { cors } from "./local/cors";
        import { STOREFRONT_ALLOWED_ORIGINS } from "./platform/storefrontOrigins";
        const app = new Hono();
        app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS }));
      `,
    );
    expect(assertion.allowlisted).toBe(false);
    expect(assertion.detail).toContain("hono/cors");
  });

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
    ).toBe(false);
    expect(
      assertCorsAllowlist(
        "packages/athena-webapp/convex/http.ts",
        `${CORS_PROLOGUE}\napp.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS }));`,
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
    await writeBaselineTree(rootDir, {
      writes: {
        def: {
          kind: "mutation",
          functionName: "inventory/products:create",
          operationId: "inventory.products.create",
          capability: "catalog.manage",
        },
      },
      reads: {
        readDef: {
          kind: "query",
          functionName: "inventory/products:list",
          operationId: "inventory.products.list.read",
          access: { kind: "read", intent: "inventory.catalog.view" },
        },
      },
    });
    await convexFixture(
      rootDir,
      "inventory/products.ts",
      `
        import { mutation, query } from "../_generated/server";
        import { admitPublicMutation, admitPublicQuery } from "../platform/operationAdmission";
        import { def } from "../operationAdmission/definitions";
        import { readDef } from "../operationAdmission/readDefinitions";

        export const create = mutation({ args: {}, handler: admitPublicMutation(def, async () => null) });
        export const list = query({ args: {}, handler: admitPublicQuery(readDef, async () => null) });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir);

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

    const result = await collectOperationAdmissionCheckResult(rootDir);

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

    const result = await collectOperationAdmissionCheckResult(rootDir);

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

  /**
   * Round 4, P1: Hono spellings that used to vanish or pass. Per-route
   * middleware runs with the full ActionCtx before the wrapper; chained
   * registration, a factory-built router, and a const-held path were not
   * discovered at all. Now: middleware is a shape rejection, chains and
   * factory routers are discovered, and every registration the checker cannot
   * follow is a `route-registration-not-statically-resolvable` finding.
   */
  it("fails closed over Hono registration spellings", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      writes: {
        mwDef: {
          kind: "http",
          route: { method: "POST", path: "/mw" },
          operationId: "http.mw",
          capability: "catalog.manage",
        },
        factoryDef: {
          kind: "http",
          route: { method: "POST", path: "/sub/factory" },
          operationId: "http.sub.factory",
          capability: "catalog.manage",
        },
      },
      reads: {
        chain1Def: {
          kind: "http_read",
          route: { method: "GET", path: "/chain1" },
          operationId: "http.chain1.read",
          access: { kind: "read", intent: "inventory.catalog.view" },
        },
        chain2Def: {
          kind: "http_read",
          route: { method: "GET", path: "/chain2" },
          operationId: "http.chain2.read",
          access: { kind: "read", intent: "inventory.catalog.view" },
        },
      },
    });
    await convexFixture(
      rootDir,
      "http/domains/core/routes/sub.ts",
      `
        import { createRouter } from "../../../routerFactory";
        import { admitHttpRoute } from "../../../../platform/operationAdmission";
        import { factoryDef } from "../../../../operationAdmission/definitions";
        export const sub = createRouter();
        sub.post("/factory", admitHttpRoute(factoryDef, async (c) => c.json({})));
      `,
    );
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { admitHttpRoute } from "./platform/operationAdmission";
        import { mwDef } from "./operationAdmission/definitions";
        import { chain1Def, chain2Def } from "./operationAdmission/readDefinitions";
        import { sub } from "./http/domains/core/routes/sub";
        import { other } from "./http/other";
        const PATH = "/constpath";
        const METHODS = ["POST"];

        app.post("/mw", async (c, next) => { await c.env.runMutation(internal.a.b, {}); await next(); }, admitHttpRoute(mwDef, async (c) => c.json({})));
        app.get("/chain1", admitHttpRead(chain1Def, async (c) => c.json({}))).get("/chain2", admitHttpRead(chain2Def, async (c) => c.json({})));
        app.post(PATH, admitHttpRoute(mwDef, async (c) => c.json({})));
        app.on(METHODS, "/onconst", admitHttpRoute(mwDef, async (c) => c.json({})));
        app.mount("/mounted", fetchHandler);
        app.route("/sub", sub);
        other.get("/elsewhere", async (c) => c.json({}));
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir);
    const byId = (prefix: string) =>
      result.findings.filter((finding) => finding.id.startsWith(prefix));

    // Chained and factory-built registrations are discovered and admitted.
    expect(
      result.ingress
        .filter((entry) => entry.route)
        .map((entry) => `${entry.id} admitted=${entry.admitted}`)
        .sort(),
    ).toEqual([
      "GET /chain1 admitted=true",
      "GET /chain2 admitted=true",
      "GET /health admitted=true",
      "POST /mw admitted=false",
      "POST /sub/factory admitted=true",
    ]);

    // Per-route middleware is a shape rejection on the route it precedes.
    const middleware = result.ingress.find((entry) => entry.id === "POST /mw");
    expect(middleware?.wrapperShape).toContain("1 middleware handler(s)");
    expect(byId("wrapper-shape-post-mw")).toHaveLength(1);
    expect(byId("definition-without-admission-wrapper-post-mw")).toHaveLength(1);

    // Everything the checker cannot follow is a high finding, one per site.
    const unresolvable = byId("route-registration-not-statically-resolvable-");
    expect(unresolvable.map((finding) => finding.functionName).sort()).toEqual([
      ".get(...)",
      ".mount(...)",
      ".on(...)",
      ".post(...)",
    ]);
    expect(unresolvable.every((finding) => finding.severity === "high")).toBe(true);
    expect(unresolvable.map((finding) => finding.rationale).join("\n")).toContain(
      "cannot resolve to a router",
    );

    // And nothing else: the admitted routes carry no findings.
    expect(
      result.findings
        .map((finding) => finding.id)
        .filter(
          (id) =>
            !id.startsWith("route-registration-not-statically-resolvable-") &&
            !id.endsWith("-post-mw"),
        ),
    ).toEqual([]);
  });

  /**
   * Round 4, P2: reconciliation proved SOME definition names the ingress and
   * the handler uses a canonical wrapper, but never that the definition
   * HANDED to the wrapper is that definition. The wrapper admits with whatever
   * it receives, so the argument is now resolved through the module's imports
   * and evaluated, and it must name this ingress.
   */
  describe("the wrapper must be handed THIS ingress's definition", () => {
    const definitions = {
      writes: {
        deleteStoreDef: {
          kind: "mutation",
          functionName: "inventory/stores:deleteStore",
          operationId: "inventory.stores.delete",
          capability: "store.configure",
        },
        publicPingDef: {
          kind: "mutation",
          functionName: "inventory/stores:ping",
          operationId: "inventory.stores.ping",
          capability: "platform.ping",
        },
      },
    };

    const check = async (site: string) => {
      const rootDir = await createFixtureRoot();
      await writeBaselineTree(rootDir, definitions);
      await convexFixture(
        rootDir,
        "inventory/stores.ts",
        `
          import { mutation } from "../_generated/server";
          import { admitPublicMutation } from "../platform/operationAdmission";
          import { deleteStoreDef, publicPingDef } from "../operationAdmission/definitions";
          import * as defs from "../operationAdmission/definitions";
          import { somethingElse } from "../inventory/helpers";
          const localDef = { kind: "mutation", functionName: "inventory/stores:deleteStore" };
          export const deleteStore = mutation({ args: {}, handler: ${site} });
          export const ping = mutation({ args: {}, handler: admitPublicMutation(publicPingDef, async () => null) });
        `,
      );
      return collectOperationAdmissionCheckResult(rootDir);
    };

    it("passes the matching definition by identifier and by namespace member", async () => {
      expect(
        (await check("admitPublicMutation(deleteStoreDef, async () => null)")).findings,
      ).toEqual([]);
      expect(
        (await check("admitPublicMutation(defs.deleteStoreDef, async () => null)")).findings,
      ).toEqual([]);
    });

    it("flags a wrapper handed another ingress's definition", async () => {
      const result = await check("admitPublicMutation(publicPingDef, async () => null)");
      expect(result.findings.map((finding) => finding.id)).toEqual([
        "admission-definition-does-not-name-this-ingress-inventory-stores-deletestore",
      ]);
      expect(result.findings[0].rationale).toContain("names `inventory/stores:ping`");
      expect(result.findings[0].severity).toBe("high");
    });

    it("flags a definition the checker cannot resolve to a registry export", async () => {
      const local = await check("admitPublicMutation(localDef, async () => null)");
      expect(local.findings.map((finding) => finding.id)).toEqual([
        "admission-definition-not-statically-resolvable-inventory-stores-deletestore",
      ]);
      expect(local.findings[0].rationale).toContain("not an import binding");

      const missing = await check("admitPublicMutation(defs.noSuchDef, async () => null)");
      expect(missing.findings.map((finding) => finding.id)).toEqual([
        "admission-definition-not-statically-resolvable-inventory-stores-deletestore",
      ]);

      const foreign = await check("admitPublicMutation(somethingElse, async () => null)");
      expect(foreign.findings.map((finding) => finding.id)).toEqual([
        "admission-definition-not-statically-resolvable-inventory-stores-deletestore",
      ]);
    });

    it("checks the definition on the const-bound and denial-mapping shapes too", async () => {
      const rootDir = await createFixtureRoot();
      await writeBaselineTree(rootDir, definitions);
      await convexFixture(
        rootDir,
        "inventory/stores.ts",
        `
          import { mutation } from "../_generated/server";
          import { admitPublicMutation } from "../platform/operationAdmission";
          import { deleteStoreDef, publicPingDef } from "../operationAdmission/definitions";
          const bound = admitPublicMutation(publicPingDef, async () => null);
          export const deleteStore = mutation({ args: {}, handler: bound });
          export const ping = mutation({
            args: {},
            handler: async (ctx, args) => {
              try {
                return await admitPublicMutation(deleteStoreDef, fn)(ctx, args);
              } catch (error) { throw error; }
            },
          });
        `,
      );
      const result = await collectOperationAdmissionCheckResult(rootDir);
      expect(result.findings.map((finding) => finding.id).sort()).toEqual([
        "admission-definition-does-not-name-this-ingress-inventory-stores-deletestore",
        "admission-definition-does-not-name-this-ingress-inventory-stores-ping",
      ]);
    });

    it("checks the definition on admitted routes", async () => {
      const rootDir = await createFixtureRoot();
      await writeBaselineTree(rootDir, {
        reads: {
          otherRead: {
            kind: "http_read",
            route: { method: "GET", path: "/other" },
            operationId: "http.other.read",
            access: { kind: "read", intent: "platform.health.view" },
          },
        },
      });
      await convexFixture(
        rootDir,
        "http.ts",
        ADMITTED_ROUTER.replace(
          "admitHttpRead(healthReadDefinition,",
          "admitHttpRead(otherRead,",
        ).replace(
          'import { healthReadDefinition } from "./operationAdmission/readDefinitions";',
          'import { otherRead } from "./operationAdmission/readDefinitions";',
        ),
      );
      const result = await collectOperationAdmissionCheckResult(rootDir);
      expect(result.findings.map((finding) => finding.id)).toContain(
        "admission-definition-does-not-name-this-ingress-get-health",
      );
    });
  });

  it("reports an exported Convex function it cannot statically resolve as a high finding", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      writes: {
        def: {
          kind: "mutation",
          functionName: "inventory/products:create",
          operationId: "inventory.products.create",
          capability: "catalog.manage",
        },
      },
    });
    await convexFixture(
      rootDir,
      "inventory/products.ts",
      `
        import { mutation } from "../_generated/server";
        import { admitPublicMutation } from "../platform/operationAdmission";
        import { def } from "../operationAdmission/definitions";
        export const create = flag
          ? mutation({ args: {}, handler: admitPublicMutation(def, async () => null) })
          : mutation({ args: {}, handler: async () => null });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "ingress-not-statically-resolvable-inventory-products-create",
    ]);
    expect(result.findings[0].severity).toBe("high");
    expect(result.raw.map((entry) => entry.id)).toEqual(["inventory/products:create"]);
  });

  it("classifies a GET route as http_read and requires the read wrapper", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      writes: {
        def: {
          kind: "http_read",
          route: { method: "GET", path: "/products" },
          operationId: "http.products.list.read",
          capability: "catalog.view",
          access: { kind: "read", intent: "inventory.catalog.view" },
        },
      },
    });
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

    const result = await collectOperationAdmissionCheckResult(rootDir);

    expect(result.findings.map((finding) => finding.id)).toContain(
      "admission-wrapper-kind-mismatch-get-products",
    );
  });

  it("verifies FRAMEWORK_ENTRY_POINTS in both directions", async () => {
    const missingRoot = await createFixtureRoot();
    await convexFixture(missingRoot, "http.ts", ADMITTED_ROUTER);
    await writeDefinitionModules(missingRoot, {}, {});
    await convexFixture(
      missingRoot,
      "auth.ts",
      `
        import { convexAuth } from "@convex-dev/auth/server";
        export const { auth, signIn } = convexAuth({ providers: [] });
      `,
    );
    const missing = await collectOperationAdmissionCheckResult(missingRoot);
    expect(missing.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "framework-entry-point-not-discovered-auth-signout",
        "framework-entry-point-not-discovered-auth-store",
      ]),
    );

    const extraRoot = await createFixtureRoot();
    await convexFixture(extraRoot, "http.ts", ADMITTED_ROUTER);
    await writeDefinitionModules(extraRoot, {}, {});
    await convexFixture(
      extraRoot,
      "auth.ts",
      `
        import { convexAuth } from "@convex-dev/auth/server";
        export const { auth, signIn, signOut, store, impersonate } = convexAuth({ providers: [] });
      `,
    );
    const extra = await collectOperationAdmissionCheckResult(extraRoot);
    expect(extra.findings.map((finding) => finding.id)).toContain(
      "unlisted-framework-registrar-export-auth-impersonate",
    );
  });

  it("requires auth.addHttpRoutes to be registered exactly once from http.ts", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        auth.addHttpRoutes(http);
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir);

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

    const result = await collectOperationAdmissionCheckResult(rootDir);

    const selfCall = result.findings.filter((finding) =>
      finding.id.startsWith("api-self-call-"),
    );
    expect(selfCall).toHaveLength(1);
    expect(selfCall[0].functionName).toBe("bagApi.getByUserId");
  });

  it("flags a reflect-any-origin CORS middleware on the router", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http.ts",
      ADMITTED_ROUTER.replace(
        "cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true })",
        "cors({ origin: (origin) => origin, credentials: true })",
      ),
    );

    const result = await collectOperationAdmissionCheckResult(rootDir);

    expect(result.findings.map((finding) => finding.id)).toContain(
      "router-cors-origin-not-allowlisted",
    );
  });

  it("does not report an action-targeting definition as stale, but does report a truly stale one", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      writes: {
        def: {
          kind: "action",
          functionName: "storeFront/reviews:sendFeedbackRequest",
          operationId: "storeFront.reviews.sendFeedbackRequest",
          capability: "customer_message.send",
        },
        staleDef: {
          kind: "mutation",
          functionName: "storeFront/reviews:deletedLongAgo",
          operationId: "storeFront.reviews.deletedLongAgo",
          capability: "reviews.manage",
        },
      },
    });
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

    const result = await collectOperationAdmissionCheckResult(rootDir);

    expect(result.findings.map((finding) => finding.id)).toEqual([
      "stale-operation-definition-storefront-reviews-deletedlongago",
    ]);
  });

  it("reports a definition without its wrapper separately from an undeclared ingress", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      writes: {
        def: {
          kind: "mutation",
          functionName: "inventory/products:create",
          operationId: "inventory.products.create",
          capability: "catalog.manage",
        },
      },
    });
    await convexFixture(
      rootDir,
      "inventory/products.ts",
      `
        import { mutation } from "../_generated/server";
        export const create = mutation({ args: {}, handler: async () => null });
      `,
    );

    const result = await collectOperationAdmissionCheckResult(rootDir);

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

    const all = await collectOperationAdmissionCheckResult(rootDir);
    expect(all.findings).toHaveLength(2);

    const scoped = await collectOperationAdmissionCheckResult(rootDir, {
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

    const result = await collectOperationAdmissionCheckResult(rootDir);

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

    const result = await collectOperationAdmissionCheckResult(rootDir);

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
    await writeBaselineTree(rootDir, {
      writes: {
        def: {
          kind: "action",
          functionName: "storeFront/onlineOrderUtilFns:sendOrderUpdateEmail",
          operationId: "storeFront.onlineOrderUtilFns.sendOrderUpdateEmail",
          capability: "order_notification.send",
          actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
        },
      },
    });
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

    const result = await collectOperationAdmissionCheckResult(rootDir);

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

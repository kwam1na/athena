import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertCorsAllowlist,
  assertRootErrorHandler,
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
  app.onError((err, c) => c.json({ error: "internal" }, 500));

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

    // Run-call sites, in source order …
    expect(sites.filter((site) => site.via !== "reference").map((site) => site.via)).toEqual([
      "runQuery",
      "runMutation",
      "runAction",
      "runAfter",
      "runAt",
    ]);
    // … plus (round 7) every OTHER value reference to an api root: the two
    // widening initializers `publicApi.storeFront.bag` and `generated.api`.
    expect(sites.filter((site) => site.via === "reference").map((site) => site.reference)).toEqual([
      expect.stringContaining("publicApi (api root referenced as a value"),
      expect.stringContaining("generated.api (api root referenced as a value"),
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
      ).toEqual(["refs.m", expect.stringContaining("api (api root referenced as a value")]);
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
    // The run call through the alias, and (round 7) the alias's own
    // `api.storeFront.bag` value reference: two sites, both high.
    expect(selfCall).toHaveLength(2);
    expect(selfCall.map((finding) => finding.functionName)).toEqual([
      "bagApi.getByUserId",
      expect.stringContaining("api (api root referenced as a value"),
    ]);
    expect(selfCall.every((finding) => finding.severity === "high")).toBe(true);
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

/**
 * Round 5. Every probe the adversarial and correctness reviewers used to
 * produce a silent pass at HEAD 3bf3eb80 is pinned here as a negative, next to
 * a positive control for the real-tree spelling that sits closest to it.
 */
describe("round 5: discovery follows the bundler's entry-point rules", () => {
  const RAW_MUTATION = `
    import { mutation } from "../_generated/server";
    export const drop = mutation({ args: {}, handler: async (ctx, args) => ctx.db.insert("t", args) });
  `;

  it.each([
    ["example/view.tsx", "example/view:drop"],
    ["example/evil.js", "example/evil:drop"],
    ["example/evil.mjs", "example/evil:drop"],
    ["example/evil.cjs", "example/evil:drop"],
    ["example/evil.mts", "example/evil:drop"],
    ["example/evil.cts", "example/evil:drop"],
    ["example/evil.jsx", "example/evil:drop"],
  ])("discovers a public function in %s", (convexPath, id) => {
    const ingress = collectConvexIngressFromSource(
      `packages/athena-webapp/convex/${convexPath}`,
      RAW_MUTATION,
    );
    expect(ingress.map((entry) => [entry.id, entry.kind, entry.admitted])).toEqual([
      [id, "mutation", false],
    ]);
  });

  it("discovers a nested _generated/ module but skips the top-level one and multi-dot basenames", () => {
    expect(
      collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/_generated/evil.ts",
        RAW_MUTATION.replace("../_generated/server", "../../_generated/server"),
      ).map((entry) => entry.id),
    ).toEqual(["example/_generated/evil:drop"]);
    for (const skipped of [
      "packages/athena-webapp/convex/_generated/server.ts",
      "packages/athena-webapp/convex/example/x.helper.ts",
      "packages/athena-webapp/convex/convex.config.ts",
      "packages/athena-webapp/convex/example/x.d.ts",
      "packages/athena-webapp/convex/example/.hidden.ts",
      "packages/athena-webapp/convex/example/x.json",
    ]) {
      expect(collectConvexIngressFromSource(skipped, RAW_MUTATION)).toEqual([]);
    }
  });

  it("walks .tsx and nested _generated/ modules on disk and reports their raw ingress", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(rootDir, "inventory/view.tsx", RAW_MUTATION);
    await convexFixture(
      rootDir,
      "inventory/_generated/evil.ts",
      RAW_MUTATION.replace("../_generated/server", "../../_generated/server"),
    );
    await convexFixture(rootDir, "_generated/server.ts", RAW_MUTATION);
    await convexFixture(rootDir, "inventory/products.helper.ts", RAW_MUTATION);

    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id).sort()).toEqual([
      "unadmitted-mutation-inventory-generated-evil-drop",
      "unadmitted-mutation-inventory-view-drop",
    ]);
  });

  it("resolves a mounted sub-router whose module carries a non-.ts extension", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http/domains/core/routes/sub.mts",
      `
        import { Hono } from "hono";
        export const sub = new Hono();
        sub.post("/x", async (c) => c.json({}));
      `,
    );
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { sub } from "./http/domains/core/routes/sub";
        app.route("/sub", sub);
      `,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.functionName)).toEqual(["POST /sub/x"]);
  });
});

describe("round 5: the builder import is matched by resolution", () => {
  const discover = (imports: string, body: string, convexPath = "example/x.ts") =>
    collectConvexIngressFromSource(
      `packages/athena-webapp/convex/${convexPath}`,
      `${imports}\n${body}`,
    );
  const RAW = `export const drop = mutation({ args: {}, handler: async () => null });`;

  it.each([
    [`import { mutation } from "../_generated/./server";`],
    [`import { mutation } from "../_generated/server/../server";`],
    [`import { mutation } from "./../_generated/server.mjs";`],
  ])("discovers a builder imported through %s", (imports) => {
    expect(discover(imports, RAW).map((entry) => [entry.id, entry.notStaticallyResolvable])).toEqual([
      ["example/x:drop", undefined],
    ]);
  });

  it("does not treat a same-named module elsewhere as the builder module", () => {
    // `example/_generated/server.ts` is NOT `_generated/server.ts`.
    expect(
      discover(`import { mutation } from "./_generated/server";`, RAW).map((entry) => entry.id),
    ).toEqual([]);
  });

  it.each([
    [
      "a shim re-exporting the builder by name",
      `export { mutation } from "./_generated/server";`,
      "shim.ts",
      "shim:mutation",
    ],
    [
      "a shim star-re-exporting the builder module",
      `export * from "../_generated/server";`,
      "example/shim.ts",
      "example/shim:*",
    ],
    [
      "a builder imported then re-exported by name",
      `import { mutation } from "../_generated/server";\nexport { mutation };`,
      "example/shim.ts",
      "example/shim:mutation",
    ],
    [
      "a builder imported then re-exported as default",
      `import { mutation } from "../_generated/server";\nexport default mutation;`,
      "example/shim.ts",
      "example/shim:default",
    ],
    [
      "a builder rebound to a top-level const",
      `import { mutation } from "../_generated/server";\nconst m = mutation;\nexport const x = m({ args: {}, handler: async () => null });`,
      "example/x.ts",
      "example/x:m",
    ],
    [
      "a builder destructured off the server namespace",
      `import * as server from "../_generated/server";\nconst { mutation } = server;\nexport const x = mutation({ args: {}, handler: async () => null });`,
      "example/x.ts",
      "example/x:mutation",
    ],
    [
      "a builder read off the server namespace by computed key",
      `import * as server from "../_generated/server";\nexport const x = server["mutation"]({ args: {}, handler: async () => null });`,
      "example/x.ts",
      "example/x:x",
    ],
    [
      "the server namespace aliased to a local",
      `import * as server from "../_generated/server";\nconst s = server;\nexport const x = s.mutation({ args: {}, handler: async () => null });`,
      "example/x.ts",
      "example/x:s",
    ],
    [
      "a builder called inside a helper the export invokes",
      `import { mutation } from "../_generated/server";\nfunction make() { return mutation({ args: {}, handler: async () => null }); }\nexport const x = make();`,
      "example/x.ts",
      "example/x:make",
    ],
    [
      "a builder passed to a helper",
      `import { mutation } from "../_generated/server";\nregister(mutation);`,
      "example/x.ts",
      "example/x:line-2",
    ],
    [
      "a generic builder re-exported from convex/server",
      `export { mutationGeneric } from "convex/server";`,
      "example/shim.ts",
      "example/shim:mutationGeneric",
    ],
  ])("reports %s as not statically resolvable", (_label, source, convexPath, id) => {
    const ingress = collectConvexIngressFromSource(
      `packages/athena-webapp/convex/${convexPath}`,
      source,
    );
    const flagged = ingress.filter((entry) => entry.notStaticallyResolvable);
    expect(flagged.map((entry) => entry.id)).toContain(id);
    expect(flagged.every((entry) => !entry.admitted)).toBe(true);
  });

  it("does not mistake a handler-local shadowing the builder name for the builder", () => {
    // The real shape in cashControls/registerSessionActivity.ts.
    const ingress = discover(
      `import { query } from "../_generated/server";
       import { admitPublicQuery } from "../platform/operationAdmission";
       import { definition } from "../operationAdmission/definitions";`,
      `export const list = query({
         args: {},
         handler: admitPublicQuery(definition, async (ctx) => {
           const query = ctx.db.query("t").withIndex("by_x");
           return query.collect();
         }),
       });
       async function helper(ctx) { const query = ctx.db.query("t"); return query.take(1); }`,
    );
    expect(ingress.map((entry) => [entry.id, entry.admitted, entry.notStaticallyResolvable])).toEqual([
      ["example/x:list", true, undefined],
    ]);
  });

  it("flags a shim in a full tree even though its consumer is invisible", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(rootDir, "shim.ts", `export { mutation } from "./_generated/server";`);
    await convexFixture(
      rootDir,
      "inventory/products.ts",
      `import { mutation } from "../shim";\nexport const drop = mutation({ args: {}, handler: async () => null });`,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "ingress-not-statically-resolvable-shim-mutation",
    ]);
    expect(result.findings[0].severity).toBe("high");
  });
});

describe("round 5: the definition handed to the wrapper must be the registered one", () => {
  const registered = {
    kind: "mutation",
    functionName: "example/x:write",
    operationId: "example.x.write",
    capability: "catalog.manage",
    actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
  };
  const shadow = { ...registered, actors: { normalUser: "admit", sharedDemo: "admit", public: "admit" } };
  const INGRESS = (definitionImport: string) => `
    import { mutation } from "../_generated/server";
    import { admitPublicMutation } from "../platform/operationAdmission";
    ${definitionImport}
    export const write = mutation({ args: {}, handler: admitPublicMutation(writeDefinition, async () => null) });
  `;

  it("flags a same-named shadow definition declared outside the definition modules", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, { writes: { writeDefinition: registered } });
    await convexFixture(
      rootDir,
      "example/shadowDefs.ts",
      `export const writeDefinition = ${JSON.stringify(shadow)};`,
    );
    await convexFixture(
      rootDir,
      "example/x.ts",
      INGRESS(`import { writeDefinition } from "./shadowDefs";`),
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "admission-definition-not-statically-resolvable-example-x-write",
    ]);
    expect(result.findings[0].rationale).toContain("not one of the definition modules");
  });

  it("flags a same-named shadow inside domains/ that the registry does not compose", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, { writes: { writeDefinition: registered } });
    await convexFixture(
      rootDir,
      "operationAdmission/domains/shadow.ts",
      `export const writeDefinition = ${JSON.stringify(shadow)};`,
    );
    await convexFixture(
      rootDir,
      "example/x.ts",
      INGRESS(`import { writeDefinition } from "../operationAdmission/domains/shadow";`),
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "admission-definition-not-registered-example-x-write",
    ]);
    expect(result.findings[0].severity).toBe("high");
    expect(result.findings[0].rationale).toContain("not the same object instance as the registered definition");
  });

  it("passes the real shape: a domains/ const composed into the registry array", async () => {
    const rootDir = await createFixtureRoot();
    await convexFixture(rootDir, "auth.ts", AUTH_MODULE);
    await convexFixture(rootDir, "http.ts", ADMITTED_ROUTER);
    await convexFixture(
      rootDir,
      "operationAdmission/domains/u1_example_definitions.ts",
      `export const writeDefinition = ${JSON.stringify(registered)};\nexport const U1_DEFINITIONS = [writeDefinition];`,
    );
    await convexFixture(
      rootDir,
      "operationAdmission/definitions.ts",
      `import { U1_DEFINITIONS } from "./domains/u1_example_definitions";\nexport const OPERATION_ADMISSION_DEFINITIONS = [...U1_DEFINITIONS];`,
    );
    await convexFixture(
      rootDir,
      "operationAdmission/readDefinitions.ts",
      `export const healthReadDefinition = ${JSON.stringify(HEALTH_READ_DEFINITION)};\nexport const OPERATION_READ_ADMISSION_DEFINITIONS = [healthReadDefinition];`,
    );
    await convexFixture(
      rootDir,
      "example/x.ts",
      INGRESS(`import { writeDefinition } from "../operationAdmission/domains/u1_example_definitions";`),
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings).toEqual([]);
  });
});

describe("round 5: routes on unresolved receivers fail closed regardless of path shape", () => {
  const SUB_ROUTER = `
    import { Hono } from "hono";
    export const sub = new Hono();
    sub.get("/health", async (c) => c.json({}));
  `;
  const check = async (extraModules: Record<string, string>, httpTail = "") => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      reads: {
        subHealth: {
          kind: "http_read",
          route: { method: "GET", path: "/sub/health" },
          operationId: "http.sub.health",
          access: { kind: "read", intent: "platform.health.view" },
        },
      },
    });
    await convexFixture(
      rootDir,
      "http/domains/core/routes/sub.ts",
      SUB_ROUTER.replace(
        `sub.get("/health", async (c) => c.json({}));`,
        `import { admitHttpRead } from "../../../../platform/operationAdmission";
         import { subHealth } from "../../../../operationAdmission/readDefinitions";
         sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));`,
      ),
    );
    for (const [convexPath, source] of Object.entries(extraModules)) {
      await convexFixture(rootDir, convexPath, source);
    }
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { sub } from "./http/domains/core/routes/sub";
        ${httpTail}
        app.route("/sub", sub);
      `,
    );
    return collectOperationAdmissionCheckResult(rootDir);
  };
  const unresolvable = (result: Awaited<ReturnType<typeof check>>) =>
    result.findings.filter((finding) =>
      finding.id.startsWith("route-registration-not-statically-resolvable-"),
    );

  it("flags a slash-less registration on an imported router in a side-effect module", async () => {
    const result = await check(
      {
        "http/domains/core/routes/late.ts": `
          import { sub } from "./sub";
          sub.get("evil", async (c) => c.json(await c.env.runQuery(internal.a.b, {})));
        `,
      },
      `import "./http/domains/core/routes/late";`,
    );
    expect(unresolvable(result).map((finding) => finding.functionName)).toEqual([".get(...)"]);
    expect(unresolvable(result)[0].rationale).toContain("cannot resolve to a router");
  });

  it("flags element-access, parameter, and import-chain receivers with any string path", async () => {
    const result = await check({
      "http/domains/core/routes/late.ts": `
        import * as mod from "./sub";
        import { sub } from "./sub";
        const routers = [sub];
        routers[0].get("evil", async (c) => c.json({}));
        mod.sub.post("evil2", async (c) => c.json({}));
        export function install(r) { r.get(\`\${""}evil3\`, async (c) => c.json({})); }
      `,
    });
    // Round 7: the router escaping into the array container is its own site.
    expect(unresolvable(result).map((finding) => finding.functionName).sort()).toEqual([
      ".get(...)",
      ".get(...)",
      ".post(...)",
      "`sub`",
    ]);
  });

  it("resolves a parenthesized router receiver: a slash-less path is a real route, a template is unresolvable", async () => {
    const result = await check({
      "http/domains/core/routes/sub.ts": `
        import { Hono } from "hono";
        import { admitHttpRead } from "../../../../platform/operationAdmission";
        import { subHealth } from "../../../../operationAdmission/readDefinitions";
        export const sub = new Hono();
        sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
        (sub).get("evil", async (c) => c.json({}));
        (sub as any).get(\`\${""}/evil2\`, async (c) => c.json({}));
      `,
    });
    expect(result.ingress.filter((entry) => entry.route).map((entry) => entry.id).sort()).toEqual([
      "GET /health",
      "GET /sub/evil",
      "GET /sub/health",
    ]);
    expect(result.findings.map((finding) => finding.id).sort()).toEqual([
      expect.stringMatching(/^route-registration-not-statically-resolvable-/),
      "unadmitted-http_read-get-sub-evil",
    ]);
  });

  it("does not mistake Convex database calls for route registrations", async () => {
    const result = await check({
      "inventory/helpers/db.ts": `
        import { DatabaseReader, DatabaseWriter } from "../../_generated/server";
        export async function readOne(db: DatabaseReader, id) { return db.get("expenseSession", id); }
        export async function patchOne(ctx, id) {
          await (ctx.db as any).patch("posTransaction", id, { closed: true });
          await ctx.db.delete("posTransaction", id);
          const db = ctx.db as unknown as { get(table: "x", id: string): Promise<null> };
          return db.get("x", id);
        }
        export async function writeOne(db: DatabaseWriter, id) { await db.patch("t", id, {}); }
      `,
    });
    expect(unresolvable(result)).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});

describe("round 5: the CORS assertion counts every spelling that resolves to hono/cors", () => {
  it.each([
    [
      "a namespaced hono/cors call after the allowlisted one",
      `import * as honoCors from "hono/cors";
       app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true }));
       app.use("*", honoCors.cors({ origin: (o) => o, credentials: true }));`,
    ],
    [
      "a rebound cors local",
      `app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true }));
       const c2 = cors;
       app.use("*", c2({ origin: (o) => o, credentials: true }));`,
    ],
    [
      "a cors destructured off the namespace",
      `import * as honoCors from "hono/cors";
       const { cors: c3 } = honoCors;
       app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true }));
       app.use("*", c3({ origin: (o) => o, credentials: true }));`,
    ],
    [
      "a cors rebound from a namespace member",
      `import * as honoCors from "hono/cors";
       const c4 = honoCors.cors;
       app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true }));
       app.use("*", c4({ origin: (o) => o, credentials: true }));`,
    ],
  ])("fails %s as a second cors() call", (_label, body) => {
    const assertion = assertCorsAllowlist(
      "packages/athena-webapp/convex/http.ts",
      `${CORS_PROLOGUE}\n${body}`,
    );
    expect(assertion.allowlisted).toBe(false);
    expect(assertion.detail).toContain("called 2 times");
  });

  it("fails a hono/cors binding used other than as the one accepted call", () => {
    const assertion = assertCorsAllowlist(
      "packages/athena-webapp/convex/http.ts",
      `${CORS_PROLOGUE}
       app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true }));
       registerElsewhere(cors);`,
    );
    expect(assertion.allowlisted).toBe(false);
    expect(assertion.detail).toContain("other than as the direct callee");
  });

  it("fails a hono/cors import that is never called on the router", () => {
    const assertion = assertCorsAllowlist(
      "packages/athena-webapp/convex/http/domains/core/routes/sub.ts",
      `import { cors } from "hono/cors";\nexport const middleware = cors;`,
    );
    expect(assertion.found).toBe(true);
    expect(assertion.allowlisted).toBe(false);
  });

  it("flags any module other than http.ts that imports or calls hono/cors", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http/domains/core/routes/sub.ts",
      `
        import { Hono } from "hono";
        import { cors } from "hono/cors";
        const reflect = (o) => o;
        export const sub = new Hono();
        sub.use("*", cors({ origin: reflect, credentials: true }));
      `,
    );
    await convexFixture(
      rootDir,
      "http/domains/core/routes/other.ts",
      `import * as honoCors from "hono/cors";\nexport const factory = honoCors;`,
    );
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { sub } from "./http/domains/core/routes/sub";
        app.route("/sub", sub);
      `,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id).sort()).toEqual([
      "cors-middleware-outside-router-module-http-domains-core-routes-other-ts",
      "cors-middleware-outside-router-module-http-domains-core-routes-sub-ts",
    ]);
    expect(result.findings.every((finding) => finding.severity === "high")).toBe(true);
  });

  it("still passes the real router: exactly one allowlisted cors() in http.ts", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings).toEqual([]);
  });
});

describe("round 5: the api.* ban covers string, symbol, and import-rooted references", () => {
  const sites = (source: string, publicFunctionNames?: Set<string>) =>
    collectApiSelfCallSites(
      "packages/athena-webapp/convex/example/refs.ts",
      source,
      publicFunctionNames ? { publicFunctionNames } : {},
    );
  const PUBLIC = new Set(["example/x:write", "example/x:read"]);

  it("is a site for a string function reference naming a public function, with no api import at all", () => {
    expect(
      sites(
        `export async function run(ctx, args) {
           await ctx.runMutation("example/x:write" as any, args);
           await ctx.scheduler.runAfter(0, "example/x:read" as any, args);
           await ctx.runMutation("example/x:internalWrite" as any, args);
         }
         export async function route(c) { return c.env.runQuery("example/x:read" as any, {}); }`,
        PUBLIC,
      ).map((site) => [site.via, site.reference]),
    ).toEqual([
      ["runMutation", expect.stringContaining("names public example/x:write")],
      ["runAfter", expect.stringContaining("names public example/x:read")],
      ["runQuery", expect.stringContaining("names public example/x:read")],
    ]);
  });

  it("is a site for a string the checker cannot enumerate, and for a const bound to a public name", () => {
    expect(
      sites(
        `const REF = "example/x:write";
         export async function run(ctx, name) {
           await ctx.runMutation(REF as any, {});
           await ctx.runQuery(\`example/x:\${name}\` as any, {});
         }`,
        PUBLIC,
      ).map((site) => site.via),
    ).toEqual(["runMutation", "runQuery"]);
  });

  it("is a site for a hand-built Symbol.for('functionName') reference, inline and through a const", () => {
    expect(
      sites(
        `const ref = { [Symbol.for("functionName")]: "example/x:write" };
         export async function run(ctx) {
           await ctx.runMutation(ref, {});
           await ctx.runAction({ [Symbol.for('functionName')]: "example/x:read" } as any, {});
         }`,
        PUBLIC,
      ).map((site) => site.via),
    ).toEqual(["runMutation", "runAction"]);
  });

  it("resolves the api root through a normalized specifier", () => {
    expect(
      sites(
        `import { api } from "../_generated/./api";
         export async function run(ctx) { await ctx.runMutation(api.example.x.write, {}); }`,
        PUBLIC,
      ).map((site) => site.reference),
    ).toEqual(["api.example.x.write"]);
  });

  it("is a site for a reference rooted at an import that is not internal from _generated/api", () => {
    expect(
      sites(
        `import { internal } from "../_generated/api";
         import * as generated from "../_generated/api";
         import { refs } from "./refs";
         import { REF } from "./constants";
         const messagingInternal = (internal as any).customerMessaging.internal;
         export async function run(ctx, config, repairFunction) {
           await ctx.runMutation(internal.a.b, {});
           await ctx.runMutation(generated.internal.a.b, {});
           await ctx.runMutation(messagingInternal.markSent, {});
           await ctx.scheduler.runAfter(0, config.workerRef, {});
           await ctx.scheduler.runAfter(0, repairFunction, {});
           await ctx.runMutation(refs.x, {});
           await ctx.runQuery(REF, {});
           await ctx.runQuery(generated.other.x, {});
         }`,
        PUBLIC,
      ).map((site) => site.reference),
    ).toEqual([
      expect.stringContaining("rooted at the import `refs`"),
      expect.stringContaining("rooted at the import `REF`"),
      expect.stringContaining("rooted at the generated namespace `generated`"),
    ]);
  });

  it("reports the string and symbol references as api-self-call findings in a full tree", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      writes: {
        def: {
          kind: "mutation",
          functionName: "example/x:write",
          operationId: "example.x.write",
          capability: "catalog.manage",
        },
      },
    });
    await convexFixture(
      rootDir,
      "example/x.ts",
      `import { mutation, internalMutation } from "../_generated/server";
       import { admitPublicMutation } from "../platform/operationAdmission";
       import { def } from "../operationAdmission/definitions";
       export const write = mutation({ args: {}, handler: admitPublicMutation(def, async () => null) });
       export const relay = internalMutation({ args: {}, handler: async (ctx, args) => ctx.runMutation("example/x:write" as any, args) });`,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      expect.stringMatching(/^api-self-call-packages-athena-webapp-convex-example-x-ts-5-/),
    ]);
  });
});

describe("round 5: exported let/var, reassignment, and re-exports fail closed", () => {
  const discover = (body: string, imports = `import { mutation, query } from "../_generated/server";`) =>
    collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/x.ts",
      `${imports}\n${body}`,
    );
  const flagged = (body: string, imports?: string) =>
    discover(body, imports)
      .filter((entry) => entry.notStaticallyResolvable)
      .map((entry) => entry.id);

  it("reports an exported let reassigned after an admitted initializer", () => {
    const ingress = discover(
      `export let write = query({ args: {}, handler: admitPublicQuery(def, async () => null) });
       write = mutation({ args: {}, handler: async (ctx, args) => ctx.db.insert("t", args) });`,
      `import { mutation, query } from "../_generated/server";
       import { admitPublicQuery } from "../platform/operationAdmission";
       import { def } from "../operationAdmission/definitions";`,
    );
    expect(ingress.every((entry) => !entry.admitted && entry.notStaticallyResolvable)).toBe(true);
    expect(ingress.map((entry) => entry.id)).toEqual(["example/x:write", "example/x:write"]);
    expect(ingress[0].notStaticallyResolvable).toContain("`let` / `var`");
    expect(ingress[1].notStaticallyResolvable).toContain("assigned after its declaration");
  });

  it("reports `let x; x = mutation(...); export { x }` and `export var`", () => {
    expect(flagged(`let x;\nx = mutation({ args: {}, handler: async () => null });\nexport { x };`)).toEqual([
      "example/x:x",
    ]);
    expect(flagged(`export var x = mutation({ args: {}, handler: async () => null });`)).toEqual([
      "example/x:x",
    ]);
  });

  it("does not report a non-exported let that a handler mutates", () => {
    expect(
      discover(
        `let cache;
         export const read = query({ args: {}, handler: async () => { cache = 1; return cache; } });`,
      ).map((entry) => [entry.id, entry.notStaticallyResolvable]),
    ).toEqual([["example/x:read", undefined]]);
  });

  it("without a repository root, a re-export from outside convex/ is unresolvable", () => {
    expect(flagged(`export { create } from "../../shared/impl";`)).toEqual(["example/x:create"]);
    expect(flagged(`import { create } from "../../shared/impl";\nexport { create };`)).toEqual([
      "example/x:create",
    ]);
    expect(flagged(`export * from "../../shared/impl";`)).toEqual(["example/x:*"]);
    expect(flagged(`import * as impl from "../../shared/impl";\nexport const create = impl.create;`)).toEqual([
      "example/x:create",
    ]);
    // A known-tree sibling, a bare package, and a type-only export are skipped.
    expect(flagged(`export { helper } from "./sibling";`)).toEqual([]);
    expect(flagged(`export { z } from "some-package";`)).toEqual([]);
    expect(flagged(`export type { T } from "../../shared/types";`)).toEqual([]);
  });

  describe("with a repository root, the external module is read", () => {
    const BUILDER_IMPL = `
      import { mutation } from "../convex/_generated/server";
      export const create = mutation({ args: {}, handler: async (ctx, args) => ctx.db.insert("t", args) });
    `;
    const PLAIN_IMPL = `export function validateServiceIntakeInput(input) { return input; }`;

    const check = async (impl: string, reexport: string) => {
      const rootDir = await createFixtureRoot();
      await writeBaselineTree(rootDir);
      // convex/operations/../../shared is packages/athena-webapp/shared, the
      // real home of the helper operations/serviceIntake.ts re-exports.
      await writeFixture(rootDir, "packages/athena-webapp/shared/impl.ts", impl);
      await convexFixture(rootDir, "operations/serviceIntake.ts", reexport);
      return collectOperationAdmissionCheckResult(rootDir);
    };

    it.each([
      [`export { create } from "../../shared/impl";`, "operations-serviceintake-create"],
      [`import { create } from "../../shared/impl";\nexport { create };`, "operations-serviceintake-create"],
      [`export * from "../../shared/impl";`, "operations-serviceintake"],
      [`import * as impl from "../../shared/impl";\nexport const create = impl.create;`, "operations-serviceintake-create"],
      [`import { create } from "../../shared/impl";\nexport default create;`, "operations-serviceintake-default"],
    ])("flags %s when the external module imports a builder", async (reexport, slug) => {
      const result = await check(BUILDER_IMPL, reexport);
      expect(result.findings.map((finding) => finding.id)).toEqual([
        `ingress-not-statically-resolvable-${slug}`,
      ]);
      expect(result.findings[0].severity).toBe("high");
      expect(result.findings[0].rationale).toContain("outside the discovered convex tree");
    });

    it("passes the real shape: a plain helper re-exported from shared/", async () => {
      const result = await check(
        PLAIN_IMPL,
        `export { validateServiceIntakeInput } from "../../shared/serviceIntake";`.replace(
          "shared/serviceIntake",
          "shared/impl",
        ),
      );
      expect(result.findings).toEqual([]);
    });

    it("fails closed when the external module cannot be located", async () => {
      const result = await check(PLAIN_IMPL, `export { create } from "../../shared/missing";`);
      expect(result.findings.map((finding) => finding.id)).toEqual([
        "ingress-not-statically-resolvable-operations-serviceintake-create",
      ]);
      expect(result.findings[0].rationale).toContain("could not be located");
    });
  });
});

describe("round 6: routes on a top-level alias or container of an imported router fail closed", () => {
  const SUB_ROUTER = `
    import { Hono } from "hono";
    import { admitHttpRead } from "../../../../platform/operationAdmission";
    import { subHealth } from "../../../../operationAdmission/readDefinitions";
    export const sub = new Hono();
    sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
  `;
  const check = async (late: string) => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      reads: {
        subHealth: {
          kind: "http_read",
          route: { method: "GET", path: "/sub/health" },
          operationId: "http.sub.health",
          access: { kind: "read", intent: "platform.health.view" },
        },
      },
    });
    await convexFixture(rootDir, "http/domains/core/routes/sub.ts", SUB_ROUTER);
    await convexFixture(rootDir, "http/domains/core/routes/late.ts", late);
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { sub } from "./http/domains/core/routes/sub";
        import "./http/domains/core/routes/late";
        app.route("/sub", sub);
      `,
    );
    return collectOperationAdmissionCheckResult(rootDir);
  };
  const unresolvable = (result: Awaited<ReturnType<typeof check>>) =>
    result.findings.filter((finding) =>
      finding.id.startsWith("route-registration-not-statically-resolvable-"),
    );

  it("flags a route on a top-level container, alias, and aliased template / variable path", async () => {
    const result = await check(`
      import { sub } from "./sub";
      const routers = { sub };
      const alias = sub;
      const P = "evil3";
      routers.sub.get("evil1", async (c) => c.json({}));
      alias.get(\`\${""}evil2\`, async (c) => c.json({}));
      alias.get(P, async (c) => c.json({}));
    `);
    // Round 7: the container (`{ sub }`) and the alias (`= sub`) are router
    // escapes in their own right, before any registration on them.
    expect(unresolvable(result).map((finding) => finding.functionName)).toEqual([
      "`sub`",
      "`sub`",
      ".get(...)",
      ".get(...)",
      ".get(...)",
    ]);
    expect(unresolvable(result).every((finding) => finding.severity === "high")).toBe(true);
    expect(result.findings).toHaveLength(5);
    // The evil routes are never mistaken for discovered ingress.
    expect(result.ingress.filter((entry) => entry.route).map((entry) => entry.id).sort()).toEqual([
      "GET /health",
      "GET /sub/health",
    ]);
  });

  it("flags array containers, conditional aliases, factory results, and destructured aliases", async () => {
    const result = await check(`
      import { sub } from "./sub";
      const list = [sub];
      const picked = list[0];
      const maybe = process.env.X ? sub : undefined;
      const made = makeRouter();
      const { r } = { r: sub };
      const P = "evil";
      // Non-literal paths, so none of these becomes a router candidate by
      // the string-literal registration rule; every one is judged as the
      // module-scoped alias it is.
      picked.post(P + "1", async (c) => c.json({}));
      maybe.post(P + "2", async (c) => c.json({}));
      made.post(P + "3", async (c) => c.json({}));
      r.post(P + "4", async (c) => c.json({}));
      function makeRouter() { return sub; }
    `);
    // Round 7: `[sub]`, `? sub`, `{ r: sub }`, and `return sub` are each a
    // router escape (the sweep runs before the registrations are judged, so
    // the escapes are reported first, in source order).
    expect(unresolvable(result).map((finding) => finding.functionName)).toEqual([
      "`sub`",
      "`sub`",
      "`sub`",
      ".post(...)",
      ".post(...)",
      ".post(...)",
      ".post(...)",
      "`sub`",
    ]);
  });

  it("does not mistake a top-level plain object or database-like local for a router", async () => {
    const result = await check(`
      const store = new Map<string, string>();
      const helpers = { get: (table: string, id: string) => \`\${table}:\${id}\` };
      const TABLE = "expenseSession";
      export function read(id: string) { return helpers.get(TABLE, id); }
      export function cached(key: string) { return store.get(key); }
    `);
    expect(unresolvable(result)).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});

describe("round 6: a raw httpAction route on the Convex HttpRouter is a finding", () => {
  it("flags http.route({ path, method, handler: httpAction(...) }) in http.ts twice: the builder and the registration", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { httpAction } from "./_generated/server";
        http.route({ path: "/evil", method: "POST", handler: httpAction(async (ctx, req) => new Response("x")) });
      `,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id).sort()).toEqual([
      expect.stringMatching(/^ingress-not-statically-resolvable-http-line-/),
      expect.stringMatching(/^route-registration-not-statically-resolvable-/),
    ]);
    expect(result.findings.every((finding) => finding.severity === "high")).toBe(true);
    const builder = result.findings.find((finding) => finding.id.startsWith("ingress-"));
    expect(builder?.rationale).toContain("raw HTTP builder");
    expect(builder?.rationale).toContain("admitHttpRoute");
    const route = result.findings.find((finding) => finding.id.startsWith("route-"));
    expect(route?.rationale).toContain("single non-string argument");
  });

  it.each([
    [
      "an exported httpAction",
      `import { httpAction } from "../_generated/server";
       export const raw = httpAction(async () => new Response("x"));`,
    ],
    [
      "a namespaced httpAction",
      `import * as server from "../_generated/server";
       export const raw = server.httpAction(async () => new Response("x"));`,
    ],
    [
      "httpActionGeneric from convex/server",
      `import { httpActionGeneric } from "convex/server";
       export const raw = httpActionGeneric(async () => new Response("x"));`,
    ],
    [
      "an httpAction handed to a helper",
      `import { httpAction } from "../_generated/server";
       register(httpAction(async () => new Response("x")));`,
    ],
  ])("reports %s as ingress-not-statically-resolvable under kind http", (_label, body) => {
    const ingress = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/x.ts",
      body,
    );
    expect(ingress).toHaveLength(1);
    expect(ingress[0].kind).toBe("http");
    expect(ingress[0].admitted).toBe(false);
    expect(ingress[0].notStaticallyResolvable).toContain("raw HTTP builder");
  });

  it("flags .route(<single non-string argument>) on any receiver, but not the Hono .route(prefix, child) mount", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        const spec = { path: "/evil", method: "GET", handler: undefined as any };
        http.route(spec);
      `,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      expect.stringMatching(/^route-registration-not-statically-resolvable-/),
    ]);
  });
});

describe("round 6: the definition handed to the wrapper must be the registered INSTANCE", () => {
  it("flags a domains/ shadow that differs from the registered definition only in a function-valued field", async () => {
    const rootDir = await createFixtureRoot();
    await convexFixture(rootDir, "auth.ts", AUTH_MODULE);
    await convexFixture(rootDir, "http.ts", ADMITTED_ROUTER);
    const definition = (resolve: string) => `{
      kind: "mutation",
      functionName: "example/x:write",
      operationId: "example.x.write",
      capability: "catalog.manage",
      scope: { kind: "store", resolve: ${resolve} },
      actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
    }`;
    await convexFixture(
      rootDir,
      "operationAdmission/domains/u1_example_definitions.ts",
      `export const writeDefinition = ${definition("(ctx, args) => ({ storeId: args.storeId })")};\nexport const U1_DEFINITIONS = [writeDefinition];`,
    );
    await convexFixture(
      rootDir,
      "operationAdmission/domains/shadow.ts",
      `export const writeDefinition = ${definition("async () => ({})")};`,
    );
    await convexFixture(
      rootDir,
      "operationAdmission/definitions.ts",
      `import { U1_DEFINITIONS } from "./domains/u1_example_definitions";\nexport const OPERATION_ADMISSION_DEFINITIONS = [...U1_DEFINITIONS];`,
    );
    await convexFixture(
      rootDir,
      "operationAdmission/readDefinitions.ts",
      `export const healthReadDefinition = ${JSON.stringify(HEALTH_READ_DEFINITION)};\nexport const OPERATION_READ_ADMISSION_DEFINITIONS = [healthReadDefinition];`,
    );
    await convexFixture(
      rootDir,
      "example/x.ts",
      `import { mutation } from "../_generated/server";
       import { admitPublicMutation } from "../platform/operationAdmission";
       import { writeDefinition } from "../operationAdmission/domains/shadow";
       export const write = mutation({ args: {}, handler: admitPublicMutation(writeDefinition, async () => null) });`,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "admission-definition-not-registered-example-x-write",
    ]);
    expect(result.findings[0].rationale).toContain("not the same object instance");
  });

  it("flags a same-module copy of the registered definition (`{ ...registered }`) even with identical fields", async () => {
    const rootDir = await createFixtureRoot();
    await convexFixture(rootDir, "auth.ts", AUTH_MODULE);
    await convexFixture(rootDir, "http.ts", ADMITTED_ROUTER);
    await convexFixture(
      rootDir,
      "operationAdmission/domains/u1_example_definitions.ts",
      `export const registeredWrite = { kind: "mutation", functionName: "example/x:write", operationId: "example.x.write", capability: "catalog.manage" };
       export const writeDefinition = { ...registeredWrite };
       export const U1_DEFINITIONS = [registeredWrite];`,
    );
    await convexFixture(
      rootDir,
      "operationAdmission/definitions.ts",
      `import { U1_DEFINITIONS } from "./domains/u1_example_definitions";\nexport const OPERATION_ADMISSION_DEFINITIONS = [...U1_DEFINITIONS];`,
    );
    await convexFixture(
      rootDir,
      "operationAdmission/readDefinitions.ts",
      `export const healthReadDefinition = ${JSON.stringify(HEALTH_READ_DEFINITION)};\nexport const OPERATION_READ_ADMISSION_DEFINITIONS = [healthReadDefinition];`,
    );
    await convexFixture(
      rootDir,
      "example/x.ts",
      `import { mutation } from "../_generated/server";
       import { admitPublicMutation } from "../platform/operationAdmission";
       import { writeDefinition } from "../operationAdmission/domains/u1_example_definitions";
       export const write = mutation({ args: {}, handler: admitPublicMutation(writeDefinition, async () => null) });`,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "admission-definition-not-registered-example-x-write",
    ]);
  });
});

describe("round 6: the api.* ban enumerates internal-rooted references", () => {
  const sites = (source: string, publicFunctionNames?: Set<string>) =>
    collectApiSelfCallSites(
      "packages/athena-webapp/convex/example/refs.ts",
      source,
      publicFunctionNames ? { publicFunctionNames } : {},
    );
  const PUBLIC = new Set(["example/x:write", "example/x:read"]);

  it("is a site when an internal-rooted dotted path names a discovered public function", () => {
    expect(
      sites(
        `import { internal } from "../_generated/api";
         import * as generated from "../_generated/api";
         export async function run(ctx, args) {
           await ctx.runMutation((internal as any).example.x.write, args);
           await ctx.runMutation(internal.example.x['write'] as any, args);
           await ctx.runQuery(generated.internal.example.x.read, {});
           await ctx.runMutation(internal.example.x.internalWrite, args);
           await ctx.runMutation(internal.example.x.other, args);
         }`,
        PUBLIC,
      ).map((site) => [site.via, site.reference]),
    ).toEqual([
      ["runMutation", expect.stringContaining("names public example/x:write")],
      ["runMutation", expect.stringContaining("names public example/x:write")],
      ["runQuery", expect.stringContaining("names public example/x:read")],
    ]);
  });

  it("is a site for a computed segment on an internal-rooted chain, and resolves through a const prefix", () => {
    expect(
      sites(
        `import { internal } from "../_generated/api";
         const ex = (internal as any).example.x;
         export async function run(ctx, name) {
           await ctx.runMutation(internal.example.x[name], {});
           await ctx.runMutation(ex.write, {});
           await ctx.runMutation(ex.internalWrite, {});
         }`,
        PUBLIC,
      ).map((site) => site.reference),
    ).toEqual([
      expect.stringContaining("computed segment"),
      expect.stringContaining("names public example/x:write"),
    ]);
  });

  it("reports the internal-rooted spellings as api-self-call findings in a full tree", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      writes: {
        def: {
          kind: "mutation",
          functionName: "example/x:write",
          operationId: "example.x.write",
          capability: "catalog.manage",
        },
      },
    });
    await convexFixture(
      rootDir,
      "example/x.ts",
      `import { mutation, internalMutation } from "../_generated/server";
       import { internal } from "../_generated/api";
       import { admitPublicMutation } from "../platform/operationAdmission";
       import { def } from "../operationAdmission/definitions";
       export const write = mutation({ args: {}, handler: admitPublicMutation(def, async () => null) });
       export const relay = internalMutation({ args: {}, handler: async (ctx, args) => ctx.runMutation((internal as any).example.x.write, args) });
       export const relay2 = internalMutation({ args: {}, handler: async (ctx, args) => ctx.runMutation(internal.example.x['write'] as any, args) });`,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      expect.stringMatching(/^api-self-call-packages-athena-webapp-convex-example-x-ts-6-/),
      expect.stringMatching(/^api-self-call-packages-athena-webapp-convex-example-x-ts-7-/),
    ]);
  });
});

describe("round 6: the external re-export scan follows plain imports and dynamic module references", () => {
  const BUILDER_IMPL = `
    import { mutation } from "../convex/_generated/server";
    export const create = mutation({ args: {}, handler: async (ctx, args) => ctx.db.insert("t", args) });
  `;
  const check = async (
    files: Record<string, string>,
    reexport = `export { create } from "../../shared/a";`,
  ) => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    for (const [relative, source] of Object.entries(files)) {
      await writeFixture(rootDir, `packages/athena-webapp/shared/${relative}`, source);
    }
    await convexFixture(rootDir, "operations/serviceIntake.ts", reexport);
    return collectOperationAdmissionCheckResult(rootDir);
  };

  it.each([
    ["import-then-export", `import { create } from "./impl";\nexport { create };`],
    ["a namespace member", `import * as impl from "./impl";\nexport const create = impl.create;`],
    ["a default import", `import impl from "./impl";\nexport const create = impl;`],
  ])("fails closed when the external module re-exports a builder through %s", async (_label, a) => {
    const result = await check({ "a.ts": a, "impl.ts": BUILDER_IMPL });
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "ingress-not-statically-resolvable-operations-serviceintake-create",
    ]);
    expect(result.findings[0].rationale).toContain("outside the discovered convex tree");
  });

  it("fails closed when a followed relative import cannot be located", async () => {
    const result = await check({
      "a.ts": `import { create } from "./missing";\nexport { create };`,
    });
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "ingress-not-statically-resolvable-operations-serviceintake-create",
    ]);
  });

  it("fails closed when the external module loads a relative module dynamically", async () => {
    const result = await check({
      "a.ts": `const impl = await import("./impl");\nexport const create = impl.create;`,
      "impl.ts": BUILDER_IMPL,
    });
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "ingress-not-statically-resolvable-operations-serviceintake-create",
    ]);
  });

  it("still passes a plain helper that imports only builder-free relative modules and bare packages", async () => {
    const result = await check(
      {
        "a.ts": `import { normalize } from "./util";\nimport path from "node:path";\nexport function validateServiceIntakeInput(input) { return normalize(input, path.sep); }`,
        "util.ts": `export function normalize(input, sep) { return input; }`,
      },
      `export { validateServiceIntakeInput } from "../../shared/a";`,
    );
    expect(result.findings).toEqual([]);
  });
});

describe("round 6: builders and hono/cors obtained outside an import declaration fail closed", () => {
  const discover = (body: string) =>
    collectConvexIngressFromSource("packages/athena-webapp/convex/example/x.ts", body);

  it.each([
    ["top-level await import of _generated/server", `const { mutation } = await import("../_generated/server");\nexport const drop = mutation({ args: {}, handler: async () => null });`],
    ["require of convex/server", `const server = require("convex/server");\nexport const drop = server.mutationGeneric({ args: {}, handler: async () => null });`],
    ["import-equals of _generated/server", `import server = require("../_generated/server");\nexport const drop = server.mutation({ args: {}, handler: async () => null });`],
    ["a non-literal dynamic specifier", `const server = await import(process.env.SERVER_MODULE);\nexport const drop = server.mutation({ args: {}, handler: async () => null });`],
  ])("reports %s as ingress-not-statically-resolvable", (_label, body) => {
    const ingress = discover(body);
    expect(ingress.length).toBeGreaterThanOrEqual(1);
    expect(ingress.every((entry) => entry.notStaticallyResolvable)).toBe(true);
    expect(ingress.some((entry) => entry.notStaticallyResolvable?.includes("outside an `import` declaration") || entry.notStaticallyResolvable?.includes("non-literal specifier"))).toBe(true);
  });

  it("does not report a dynamic import of an unrelated module", () => {
    expect(
      discover(`export async function load() { const m = await import("./sibling"); return m.x; }`),
    ).toEqual([]);
  });

  it("fails the CORS assertion when hono/cors is loaded through import()", () => {
    const assertion = assertCorsAllowlist(
      "packages/athena-webapp/convex/http.ts",
      `import { Hono } from "hono";
       import { STOREFRONT_ALLOWED_ORIGINS } from "./platform/storefrontOrigins";
       const app = new Hono();
       const honoCors = await import("hono/cors");
       app.use("*", honoCors.cors({ origin: (o) => o }));`,
    );
    expect(assertion.found).toBe(true);
    expect(assertion.allowlisted).toBe(false);
    expect(assertion.detail).toContain("import()");
  });
});

describe("round 7: the router reference sweep — a router value outside the accepted shapes is a finding", () => {
  const SUB_ROUTER = `
    import { Hono } from "hono";
    import { admitHttpRead } from "../../../../platform/operationAdmission";
    import { subHealth } from "../../../../operationAdmission/readDefinitions";
    export const sub = new Hono();
    sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
  `;
  const check = async (late: string, httpTail = "") => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      reads: {
        subHealth: {
          kind: "http_read",
          route: { method: "GET", path: "/sub/health" },
          operationId: "http.sub.health",
          access: { kind: "read", intent: "platform.health.view" },
        },
      },
    });
    await convexFixture(rootDir, "http/domains/core/routes/sub.ts", SUB_ROUTER);
    await convexFixture(rootDir, "http/domains/core/routes/late.ts", late);
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { sub } from "./http/domains/core/routes/sub";
        import "./http/domains/core/routes/late";
        app.route("/sub", sub);
        ${httpTail}
      `,
    );
    return collectOperationAdmissionCheckResult(rootDir);
  };
  const unresolvable = (result: Awaited<ReturnType<typeof check>>) =>
    result.findings.filter((finding) =>
      finding.id.startsWith("route-registration-not-statically-resolvable-"),
    );
  const routes = (result: Awaited<ReturnType<typeof check>>) =>
    result.ingress.filter((entry) => entry.route).map((entry) => entry.id).sort();

  it("flags a bracket callee, .call / .apply / .bind / Reflect.apply on a verb, and a spread argument list on an imported router", async () => {
    const result = await check(`
      import { sub } from "./sub";
      const h = async (c) => c.json({});
      const args = ["evil", h];
      sub["get"]("evil2", h);
      sub["get"]("/evil2b", h);
      sub.get.call(sub, "evil7", h);
      Reflect.apply(sub.get, sub, ["evil7b", h]);
      const g = sub.get.bind(sub); g("evil8", h);
      sub.get.apply(sub, ["evil8b", h]);
      sub.get(...args);
    `);
    // One high finding per line: lines 5-11 of the fixture (the two `sub`
    // reads on the `.call` line collapse to one site).
    expect(unresolvable(result).map((finding) => finding.line)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    expect(unresolvable(result).every((finding) => finding.severity === "high")).toBe(true);
    // A bracket callee with a literal index is the same call as `.get(...)`
    // and is judged by the walk (import receiver, any path); the `.call` /
    // `Reflect.apply` / `.bind` / `.apply` spellings are router escapes caught
    // by the sweep; the spread is a positioning failure.
    expect(unresolvable(result).map((finding) => finding.functionName)).toEqual([
      ".get(...)",
      ".get(...)",
      "`sub`",
      "`sub`",
      "`sub`",
      "`sub`",
      ".get(...)",
    ]);
    expect(unresolvable(result)[0].rationale).toContain("cannot resolve to a router");
    expect(unresolvable(result)[2].rationale).toContain("referenced as a value");
    expect(unresolvable(result)[6].rationale).toContain("spread argument");
    expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
  });

  it("flags http[\"route\"](spec) and a spread registration on the root router in http.ts", async () => {
    const result = await check(
      `export {};`,
      `const spec = { path: "/evil", method: "GET", handler: undefined as any };
       http["route"](spec);
       const rest = ["/evil2", async (c) => c.json({})] as const;
       app.get(...rest);`,
    );
    // `http["route"](spec)` IS `.route(spec)`: the single-non-string rule
    // fires exactly as for the dotted spelling.
    expect(unresolvable(result).map((finding) => finding.functionName)).toEqual([
      ".route(...)",
      ".get(...)",
    ]);
    expect(unresolvable(result)[0].rationale).toContain("single non-string argument");
    expect(unresolvable(result)[1].rationale).toContain("spread argument");
    expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
  });

  it("flags slash-less routes on a call-result, comma, conditional, class-static, namespace, getter, and method receiver", async () => {
    const result = await check(`
      import { sub } from "./sub";
      const h = async (c) => c.json({});
      function pick() { return sub; }
      pick().get("evil1", h);
      (0, sub).get("evil3", h);
      (process.env.X ? sub : sub).get("evil3b", h);
      class Holder { static r = sub }
      Holder.r.get("evil9", h);
      namespace N { export const r = sub }
      N.r.get("evil9b", h);
      const box = { get r() { return sub } };
      box.r.get("evil10", h);
      const box2 = { r() { return sub } };
      box2.r().get("evil11", h);
    `);
    // Every escape (`return sub`, `(0, sub)`, `? sub : sub`, `static r = sub`,
    // `export const r = sub`, `return sub` in the getter and the method) AND
    // every registration on the derived receiver is a site, one per line.
    expect(unresolvable(result).map((finding) => finding.line)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(unresolvable(result).every((finding) => finding.severity === "high")).toBe(true);
    expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
  });

  it("flags a router stored on globalThis or on a container mutated after declaration", async () => {
    const result = await check(`
      import { sub } from "./sub";
      const h = async (c) => c.json({});
      (globalThis as any).r = sub;
      (globalThis as any).r.get("evil", h);
      const holder: any = {};
      holder.r = sub;
      holder.r.get("evil2", h);
    `);
    // The two assignments are escapes; the two registrations are on
    // module-scoped receivers (`globalThis`, the top-level `holder`, whose
    // initializer `{}` proves nothing about what it holds later — but the
    // `holder.r = sub` escape already fails the module).
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [4, "`sub`"],
      [5, ".get(...)"],
      [7, "`sub`"],
    ]);
  });

  it("flags a router that escapes into a helper call, a return, an object property, or an assignment even with no registration in sight", async () => {
    const result = await check(`
      import { sub } from "./sub";
      import * as mod from "./sub";
      export function expose() { return sub; }
      export const table = { router: sub };
      register(sub);
      let alias; alias = sub;
      const viaNamespace = mod;
    `);
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [4, "`sub`"],
      [5, "`sub`"],
      [6, "`sub`"],
      [7, "`sub`"],
      [8, "`mod`"],
    ]);
    expect(unresolvable(result)[4].rationale).toContain("namespace import of router module");
  });

  it("flags a bracket or computed method and a spread on a router handed in as a parameter", async () => {
    const result = await check(`
      const h = async (c) => c.json({});
      export function install(r, m, args) {
        r["get"]("evil", h);
        r[m]("evil2", h);
        r.post(...args);
      }
    `);
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [4, ".get(...)"],
      [5, ".[computed](...)"],
      [6, ".post(...)"],
    ]);
    expect(unresolvable(result)[1].rationale).toContain("computed method");
  });

  it("does not flag the accepted shapes: registrations, .route mounts, new HttpRouterWithHono, addHttpRoutes, exports, and a router-free helper", async () => {
    const result = await check(`
      import { sub } from "./sub";
      import { admitHttpRead } from "../../../../platform/operationAdmission";
      import { subHealth } from "../../../../operationAdmission/readDefinitions";
      // A second registration on the imported router is a REAL route (walked
      // from its declaration), so it is judged as ingress, not as an escape.
      export function noop() { return 1; }
      export { sub as reexported };
    `);
    expect(unresolvable(result)).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("pins the destructured-top-level-binding rule: a call-result destructure is unresolvable (fail closed), an object-literal destructure without a router mention is not", async () => {
    const flagged = await check(`
      const { cache } = makeCache();
      cache.get("k", 1);
      function makeCache() { return new Map<string, number>(); }
    `);
    // `const { cache } = makeCache()` is judged by its initializer exactly like
    // `const cache = makeCache()` (round 6): a call result is unresolvable, so
    // a two-argument \`.get("k", 1)\` on it is a registration-shaped call on a
    // module-scoped unresolvable receiver — a finding. Spell such a helper as
    // \`new Map()\` at the top level, or call it under a name that is not a
    // Hono verb.
    expect(unresolvable(flagged).map((finding) => [finding.line, finding.functionName])).toEqual([
      [3, ".get(...)"],
    ]);

    const clean = await check(`
      const { helpers } = { helpers: { get: (table: string, id: string) => \`\${table}:\${id}\` } };
      const methodStyle = { get(table: string, id: string) { return this.prefix + table + id; }, prefix: "x" };
      const TABLE = "expenseSession";
      export function read(id: string) { return helpers.get(TABLE, id) + methodStyle.get(TABLE, id); }
      export function cached(store: Map<string, string>, key: string) { return store.get(key); }
    `);
    expect(unresolvable(clean)).toEqual([]);
    expect(clean.findings).toEqual([]);
  });

  it("keeps the database disambiguation through aliases of the context parameter", async () => {
    const result = await check(`
      import { DatabaseWriter, MutationCtx } from "../../../../_generated/server";
      export async function a(admittedCtx: MutationCtx, id) {
        const ctx = admittedCtx;
        await ctx.db.patch("t", id, {});
        const mutationCtx = ctx as MutationCtx;
        await mutationCtx.db.get("t", id);
      }
      export async function b(args: { ctx: MutationCtx; id: string }) {
        return args.ctx.db.get("t", args.id);
      }
      export async function c(db: DatabaseWriter, id) { await db.patch("t", id, {}); }
    `);
    expect(unresolvable(result)).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("does not follow a router module through a namespace member as a .route child, and flags it", async () => {
    const result = await check(
      `export {};`,
      `import * as routes from "./http/domains/core/routes/sub";
       app.route("/sub2", routes.sub);`,
    );
    // The mount rule rejects a non-identifier child; the same line is also a
    // namespace-import escape for the sweep (one finding per line).
    expect(unresolvable(result).map((finding) => finding.functionName)).toEqual([".route(...)"]);
    expect(unresolvable(result)[0].rationale).toContain("child router identifier");
  });
});

describe("round 7: the api.* ban is a reference ban, matched by name at every run-site shape", () => {
  const sites = (source: string, publicFunctionNames?: Set<string>) =>
    collectApiSelfCallSites(
      "packages/athena-webapp/convex/example/refs.ts",
      source,
      publicFunctionNames ? { publicFunctionNames } : {},
    );
  const PUBLIC = new Set(["example/x:write", "example/x:read"]);

  it("is a site for internal threaded through a destructure, an object / array / spread container, an array destructure, or a shadowed local", () => {
    const found = sites(
      `import { internal } from "../_generated/api";
       const { example } = internal as any;
       const refs = { w: (internal as any).example.x.write };
       const ex = { ...(internal as any).example };
       const [w] = [(internal as any).example.x.write];
       const list = [(internal as any).example.x.write];
       const shadowed = (internal as any).example.x;
       export async function run(ctx, args) {
         await ctx.runMutation(example.x.write, args);
         await ctx.runMutation(refs.w, args);
         await ctx.runMutation(ex.x.write, args);
         await ctx.runMutation(w, args);
         await ctx.runMutation(list[0], args);
         { const shadowed = { write: null }; await ctx.runMutation(shadowed.write, args); }
       }`,
      PUBLIC,
    );
    expect(found.map((site) => site.via)).toEqual([
      "runMutation",
      "runMutation",
      "runMutation",
      "runMutation",
      "runMutation",
      "runMutation",
    ]);
    expect(found.every((site) => site.reference.includes("cannot be enumerated"))).toBe(true);
  });

  it("still enumerates a plain internal prefix local, and accepts a non-public internal path through it", () => {
    expect(
      sites(
        `import { internal } from "../_generated/api";
         const ex = (internal as any).example.x;
         export async function run(ctx) {
           await ctx.runMutation(ex.write, {});
           await ctx.runMutation(ex.internalWrite, {});
         }`,
        PUBLIC,
      ).map((site) => site.reference),
    ).toEqual([expect.stringContaining("names public example/x:write")]);
  });

  it("is a site for an api reference held in an array container", () => {
    expect(
      sites(
        `import { api } from "../_generated/api";
         const list = [api.example.x.write];
         export async function run(ctx, args) { await ctx.runMutation(list[0], args); }`,
      ).map((site) => [site.via, site.reference]),
    ).toEqual([
      ["runMutation", "list[0]"],
      ["reference", expect.stringContaining("api (api root referenced as a value")],
    ]);
  });

  it("judges a conditional function reference on both branches, and fails closed on a shape it cannot root", () => {
    expect(
      sites(
        `import { api, internal } from "../_generated/api";
         export async function run(ctx, flag, args) {
           await ctx.runMutation(flag ? api.example.x.write : internal.example.x.internalWrite, args);
           await ctx.runMutation(flag ? internal.example.x.other : internal.example.x.write, args);
           await ctx.runMutation(flag ? internal.example.x.other : internal.example.x.internalWrite, args);
           await ctx.runMutation((0, internal.example.x.other), args);
           await ctx.runMutation(pick().write, args);
           await ctx.runMutation(pick(), args);
         }`,
        PUBLIC,
      ).map((site) => [site.via, site.reference]),
    ).toEqual([
      ["runMutation", expect.stringContaining("conditional function reference selects api.example.x.write")],
      ["runMutation", expect.stringContaining("names public example/x:write")],
      ["runMutation", expect.stringContaining("shape the checker cannot root")],
      ["runMutation", expect.stringContaining("shape the checker cannot root")],
    ]);
  });

  it.each([
    ["a bracket callee", `ctx["runMutation"](api.example.x.write, args)`],
    ["a rebound run method", `const r = ctx.runMutation; await r(api.example.x.write, args)`],
    ["a bound run method", `const r = ctx.runMutation.bind(ctx); await r(api.example.x.write, args)`],
    [".call", `await ctx.runMutation.call(ctx, api.example.x.write, args)`],
    [".apply with a literal list", `await ctx.runMutation.apply(ctx, [api.example.x.write, args])`],
    ["Reflect.apply", `await Reflect.apply(ctx.runMutation, ctx, [api.example.x.write, args])`],
    ["a destructured context local", `const { runMutation } = ctx; await runMutation(api.example.x.write, args)`],
    ["a scheduler on any receiver", `const s = ctx.scheduler; await s.runAfter(0, api.example.x.write, args)`],
    ["a bracket scheduler", `await ctx["scheduler"]["runAt"](0, api.example.x.write, args)`],
  ])("reports %s as a run-call site (and not twice)", (_label, body) => {
    const found = sites(
      `import { api } from "../_generated/api";
       export async function run(ctx, args) { ${body}; }`,
    );
    expect(found).toHaveLength(1);
    expect(found[0].reference).toBe("api.example.x.write");
    expect(found[0].via).toMatch(/^run/);
  });

  it("reports a destructured context PARAMETER run call, by internal enumeration too", () => {
    expect(
      sites(
        `import { api, internal } from "../_generated/api";
         export async function run({ runMutation, scheduler }, args) {
           await runMutation(api.example.x.write, args);
           await runMutation(internal.example.x.write, args);
           await runMutation(internal.example.x.internalWrite, args);
           await scheduler.runAfter(0, internal.example.x.read, args);
         }`,
        PUBLIC,
      ).map((site) => [site.via, site.reference]),
    ).toEqual([
      ["runMutation", "api.example.x.write"],
      ["runMutation", expect.stringContaining("names public example/x:write")],
      ["runAfter", expect.stringContaining("names public example/x:read")],
    ]);
  });

  it("fails closed on .apply / Reflect.apply with an argument list it cannot see into", () => {
    expect(
      sites(
        `import { internal } from "../_generated/api";
         export async function run(ctx, argv) {
           await ctx.runMutation.apply(ctx, argv);
           await Reflect.apply(ctx.runMutation, ctx, argv);
           await ctx.runMutation.apply(ctx, [...argv]);
         }`,
      ).map((site) => site.reference),
    ).toEqual([
      expect.stringContaining("cannot see into"),
      expect.stringContaining("cannot see into"),
      expect.stringContaining("cannot position"),
    ]);
  });

  it("is a site for ANY value reference to an api root, not only a run-call argument", () => {
    const found = sites(
      `import { api } from "../_generated/api";
       import * as generated from "../_generated/api";
       import * as convexServer from "convex/server";
       export const table = { w: api.example.x.write };
       helper(api);
       const g = generated;
       const viaNs = generated.api.example.x.write;
       const computed = generated["api"];
       const any = convexServer.anyApi.example.x.write;
       export async function run(ctx, args) { await ctx.runQuery(generated.internal.example.x.read, {}); }`,
    );
    expect(found.map((site) => site.via)).toEqual(["reference", "reference", "reference", "reference", "reference", "reference"]);
    expect(found.map((site) => site.reference.split(" ")[0])).toEqual([
      "api",
      "api",
      "generated",
      "generated.api",
      "generated.api",
      "convexServer.anyApi",
    ]);
  });

  it("stays silent on internal-only modules whatever the run-site spelling", () => {
    expect(
      sites(
        `import { internal } from "../_generated/api";
         import * as generated from "../_generated/api";
         export async function run({ runMutation }, ctx, args) {
           await runMutation(internal.example.x.internalWrite, args);
           await ctx["runQuery"](internal.example.x.other, {});
           await ctx.runMutation.call(ctx, generated.internal.example.x.other, args);
           const s = ctx.scheduler; await s.runAfter(0, internal.example.x.other, args);
         }`,
        PUBLIC,
      ),
    ).toEqual([]);
  });

  it("resolves an api root imported through the @cvx/ tsconfig alias", () => {
    expect(
      sites(
        `import { api } from "@cvx/_generated/api";
         export async function run(ctx, args) { await ctx.runMutation(api.example.x.write, args); }`,
      ).map((site) => site.reference),
    ).toEqual(["api.example.x.write"]);
  });

  it("reports the reference-sweep sites as api-self-call findings in a full tree", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "example/x.ts",
      `import { api } from "../_generated/api";
       export const refs = { w: api.example.x.write };
       export async function run({ runMutation }, args) { await runMutation(refs.w, args); }`,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      expect.stringMatching(/^api-self-call-packages-athena-webapp-convex-example-x-ts-3-/),
      expect.stringMatching(/^api-self-call-packages-athena-webapp-convex-example-x-ts-2-/),
    ]);
    expect(result.findings.every((finding) => finding.severity === "high")).toBe(true);
  });
});

describe("round 7: CORS, tsconfig aliases, and environment-free definition modules", () => {
  it("fails the CORS assertion on a non-literal dynamic import specifier in http.ts beside a legitimate cors()", () => {
    const assertion = assertCorsAllowlist(
      "packages/athena-webapp/convex/http.ts",
      `${CORS_PROLOGUE}
       app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS, credentials: true }));
       const spec = "hono/" + "cors";
       const c2 = await import(spec);
       app.use("*", c2.cors({ origin: (o) => o }));`,
    );
    expect(assertion.found).toBe(true);
    expect(assertion.allowlisted).toBe(false);
    expect(assertion.detail).toContain("not a string literal");
  });

  it("fails the CORS assertion on a tsconfig-alias import or dynamic reference in a router-declaring module", () => {
    for (const source of [
      `${CORS_PROLOGUE}
       import { helper } from "~/node_modules/hono/cors";
       app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS }));`,
      `${CORS_PROLOGUE}
       const c2 = await import("@cvx/../node_modules/hono/cors");
       app.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS }));`,
    ]) {
      const assertion = assertCorsAllowlist("packages/athena-webapp/convex/http.ts", source);
      expect(assertion.allowlisted).toBe(false);
      expect(assertion.detail).toContain("paths` alias");
    }
  });

  it("does not treat a non-literal dynamic import in a router-free module as a CORS registration (discovery reports it)", () => {
    const assertion = assertCorsAllowlist(
      "packages/athena-webapp/convex/example/x.ts",
      `export async function load(spec) { const m = await import(spec); return m.x; }`,
    );
    expect(assertion.found).toBe(false);
    const ingress = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/x.ts",
      `export async function load(spec) { const m = await import(spec); return m.x; }`,
    );
    expect(ingress.some((entry) => entry.notStaticallyResolvable?.includes("non-literal specifier"))).toBe(true);
  });

  it.each([
    ["@cvx/_generated/server", `import { mutation } from "@cvx/_generated/server";`],
    ["~/convex/_generated/server", `import { mutation } from "~/convex/_generated/server";`],
    ["@/lib/anything", `import { mutation } from "@/lib/anything";`],
    ["a dynamic alias reference", `const { mutation } = await import("@cvx/_generated/server");`],
  ])("reports an import through the tsconfig alias %s as ingress-not-statically-resolvable, and still resolves the builder", (_label, header) => {
    const ingress = collectConvexIngressFromSource(
      "packages/athena-webapp/convex/example/x.ts",
      `${header}\nexport const drop = mutation({ args: {}, handler: async () => null });`,
    );
    expect(ingress.some((entry) => entry.notStaticallyResolvable?.includes("paths` alias"))).toBe(true);
    expect(ingress.every((entry) => !entry.admitted)).toBe(true);
  });

  it("does not report a plain package or relative import as an alias", () => {
    expect(
      collectConvexIngressFromSource(
        "packages/athena-webapp/convex/example/x.ts",
        `import path from "node:path";\nimport { z } from "../helpers/z";\nexport const noop = () => path.sep + z;`,
      ),
    ).toEqual([]);
  });

  it("flags a definition module that reads the environment, in a full tree", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "operationAdmission/domains/u1_example_definitions.ts",
      `export const writeDefinition = {
         kind: "mutation",
         functionName: "example/x:write",
         operationId: "example.x.write",
         capability: "catalog.manage",
         actors: { normalUser: "admit", sharedDemo: "deny", public: process.env.ADMIT_PUBLIC ? "admit" : "deny" },
       };
       export const flag = import.meta.env?.MODE;
       export const U1_DEFINITIONS = [writeDefinition];`,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      expect.stringMatching(/^definition-module-reads-environment-operationadmission-domains-u1-example-definitions-ts-6/),
      expect.stringMatching(/^definition-module-reads-environment-operationadmission-domains-u1-example-definitions-ts-8/),
    ]);
    expect(result.findings.every((finding) => finding.severity === "high")).toBe(true);
  });

  it("does not flag the real definition modules", async () => {
    // The real tree's definitions.ts / readDefinitions.ts / domains/** read no
    // environment; the whole-tree run in coverage.test.ts pins zero findings,
    // and this pins the rule against the checked-in domain shapes module.
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "operationAdmission/domains/_shapes.ts",
      await readFile(
        path.join(process.cwd(), "packages/athena-webapp/convex/operationAdmission/domains/_shapes.ts"),
        "utf8",
      ),
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    expect(result.findings.filter((finding) => finding.id.startsWith("definition-module-reads-environment-"))).toEqual([]);
  });
});

describe("round 8: factory-built routers, dynamically imported router modules, wrapped computed callees, and environment imports", () => {
  const SUB_ROUTER = `
    import { Hono } from "hono";
    import { admitHttpRead } from "../../../../platform/operationAdmission";
    import { subHealth } from "../../../../operationAdmission/readDefinitions";
    export const sub = new Hono();
    sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
  `;
  const check = async (
    late: string,
    httpTail = "",
    options: { subRouter?: string; extraModules?: Record<string, string> } = {},
  ) => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      reads: {
        subHealth: {
          kind: "http_read",
          route: { method: "GET", path: "/sub/health" },
          operationId: "http.sub.health",
          access: { kind: "read", intent: "platform.health.view" },
        },
      },
    });
    await convexFixture(
      rootDir,
      "http/domains/core/routes/sub.ts",
      options.subRouter ?? SUB_ROUTER,
    );
    await convexFixture(rootDir, "http/domains/core/routes/late.ts", late);
    for (const [convexPath, source] of Object.entries(options.extraModules ?? {})) {
      await convexFixture(rootDir, convexPath, source);
    }
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { sub } from "./http/domains/core/routes/sub";
        import "./http/domains/core/routes/late";
        app.route("/sub", sub);
        ${httpTail}
      `,
    );
    return collectOperationAdmissionCheckResult(rootDir);
  };
  const unresolvable = (result: Awaited<ReturnType<typeof check>>) =>
    result.findings.filter((finding) =>
      finding.id.startsWith("route-registration-not-statically-resolvable-"),
    );
  const routes = (result: Awaited<ReturnType<typeof check>>) =>
    result.ingress.filter((entry) => entry.route).map((entry) => entry.id).sort();

  it("flags a factory-built router registering a const path on its nested `new Hono()` before it is mounted", async () => {
    // (a) `const P = "/evil"` on a nested-scope receiver: served as
    // `GET /sub/evil` with no admission; the nested `new Hono()` local is a
    // router the checker cannot see into, so ANY path expression is a route,
    // and `return r` is an escape of a router the walk never reaches.
    const result = await check(`export {};`, "", {
      subRouter: `
        import { Hono } from "hono";
        import { admitHttpRead } from "../../../../platform/operationAdmission";
        import { subHealth } from "../../../../operationAdmission/readDefinitions";
        const h = async (c) => c.json({});
        function make() {
          const r = new Hono();
          const P = "/evil";
          r.get(P, h);
          return r;
        }
        export const sub = make();
        sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
      `,
    });
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [9, ".get(...)"],
      [10, "`r`"],
    ]);
    expect(unresolvable(result)[0].rationale).toContain("cannot resolve to a router");
    expect(unresolvable(result)[1].rationale).toContain("built inside a function or block");
    expect(unresolvable(result).every((finding) => finding.severity === "high")).toBe(true);
    expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
  });

  it("flags a factory-built router registering a parameter path, whatever the factory is called with", async () => {
    // (b) the path is the factory's parameter: `make("evil")` serves
    // `GET /sub/evil`.
    const result = await check(`export {};`, "", {
      subRouter: `
        import { Hono } from "hono";
        import { admitHttpRead } from "../../../../platform/operationAdmission";
        import { subHealth } from "../../../../operationAdmission/readDefinitions";
        const h = async (c) => c.json({});
        function make(p: string) {
          const r = new Hono();
          r.get(p, h);
          return r;
        }
        export const sub = make("evil");
        sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
      `,
    });
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [8, ".get(...)"],
      [9, "`r`"],
    ]);
  });

  it("flags a factory in http.ts whose result is mounted with .route", async () => {
    // (c) the factory lives beside the root router; `child` is a top-level
    // candidate (it is mounted), but the routes it carries were registered
    // inside `make` on the nested local.
    const result = await check(
      `export {};`,
      `function make() {
         const r = new Hono();
         const P = "/evil";
         r.get(P, async (c) => c.json({}));
         return r;
       }
       const child = make();
       app.route("/c", child);`,
    );
    expect(unresolvable(result).map((finding) => finding.functionName)).toEqual([
      ".get(...)",
      "`r`",
    ]);
    expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
  });

  it("flags a nested call-result / awaited receiver with a non-literal path, and keeps a parameter receiver on the string rule", async () => {
    const result = await check(`
      import { Hono } from "hono";
      const h = async (c) => c.json({});
      const P = "/evil";
      export function a() { const r = makeRouter(); r.get(P, h); }
      export async function b() { const r = await loadRouter(); r.post(P, h); }
      export function c(r) { r.get(P, h); }
      export function d(r) { r.get("evil", h); }
      export function e() { const r = new Hono(); helper(r); }
      export function f() { const cache = new Map(); cache.set(P, h); return cache.get(P, h); }
      declare function makeRouter(): any; declare function loadRouter(): Promise<any>; declare function helper(x: any): void;
    `);
    // `a` / `b`: nested opaque initializers, any path (round 8). `c`: a
    // parameter receiver keeps the string / template rule (a `const P` on it
    // is the documented caller-table residual — the router must be handed in
    // as a value somewhere, and THAT reference is the sweep's site). `d`: the
    // string rule. `e`: a nested `new Hono()` handed to a helper is an escape.
    // `f`: `new Map()` is a plain container.
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [5, ".get(...)"],
      [6, ".post(...)"],
      [8, ".get(...)"],
      [9, "`r`"],
    ]);
  });

  it("flags a router module loaded through import() / require(), and not a router-free one", async () => {
    const result = await check(`
      const h = async (c) => c.json({});
      const P = "/evil";
      void import("./sub").then((m) => m.sub.get(P, h));
      export async function later() { const m = await import("./sub"); m.sub.get(P, h); }
      const viaRequire = require("./sub");
      export async function other() { const m = await import("./helpers"); return m.x; }
      export async function unknownSpecifier(spec: string) { const m = await import(spec); return m; }
    `, "", {
      extraModules: {
        "http/domains/core/routes/helpers.ts": `export const x = 1;`,
      },
    });
    // Line 4: the `.then((m) => ...)` parameter keeps the string rule, so the
    // `import("./sub")` itself is the escape. Line 5: `m` is an awaited nested
    // local — an opaque receiver, any path — so the walk flags the
    // registration first (one finding per line). Line 6: `require("./sub")`.
    // Line 7: the router-free `./helpers` is not a finding. Line 8: the
    // non-literal specifier fails closed (it may name a router module).
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [4, "`import(\"./sub\")`"],
      [5, ".get(...)"],
      [6, "`require(\"./sub\")`"],
      [8, "`import(spec)`"],
    ]);
    expect(unresolvable(result)[0].rationale).toContain("loaded through `import()` / `require()`");
    expect(unresolvable(result)[2].rationale).toContain("loaded through `import()` / `require()`");
    expect(unresolvable(result)[3].rationale).toContain("non-literal specifier");
    expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
  });

  it("flags a default-imported router referenced as a value, in a module with no router-ish binding of its own", async () => {
    const result = await check(`
      import http from "../../../../http";
      export const keep = http;
    `);
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [3, "`http`"],
    ]);
    expect(unresolvable(result)[0].rationale).toContain("imported from `http.ts`");
  });

  it("reports (does not crash on) a computed router-method callee wrapped in parens, `as`, or a non-null assertion", async () => {
    const result = await check(`
      import { Hono } from "hono";
      import { sub } from "./sub";
      const h = async (c) => c.json({});
      const verb = "get";
      ((sub)[verb])("evil", h);
      (sub as Hono)[verb]!("evil2", h);
      export function install(r, m) { ((r as Hono)[m])!("evil3", h); }
    `);
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [6, ".[computed](...)"],
      [7, ".[computed](...)"],
      [8, ".[computed](...)"],
    ]);
    expect(unresolvable(result)[0].rationale).toContain("computed method `(sub)[verb](...)`");
    expect(unresolvable(result)[1].rationale).toContain("computed method `(sub as Hono)[verb](...)`");
    expect(unresolvable(result)[2].rationale).toContain("computed method `(r as Hono)[m](...)`");
  });

  it("flags `.use(<path>, <non-cors handler>)` on an imported router as a registration on a receiver it cannot resolve (round 9 closed the residual)", async () => {
    // A path-scoped `.use` whose handler never calls `next()` is a terminal
    // responder for every method under the path. Through round 8 this was
    // the one pinned residual (`.use` was invisible to the walk); round 9
    // walks `.use` like every other registration. On an IMPORTED router the
    // receiver itself is unresolvable in this module, so the site fails as a
    // route registration; on a router declared in the module it is judged by
    // the middleware grammar (see the round-9 block).
    const result = await check(`
      import { sub } from "./sub";
      sub.use("/evil", async (c) => c.json({ pwned: true }));
    `);
    expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
      [3, ".use(...)"],
    ]);
    expect(unresolvable(result)[0].rationale).toContain("`.use(...)` is called on a receiver the checker cannot resolve");
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "route-registration-not-statically-resolvable-packages-athena-webapp-convex-http-domains-core-routes-late-ts-3",
    ]);
    expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
  });

  describe("round 9: a router constructed outside `const <name> = new Hono()` fails closed at the construction", () => {
    it("flags a router built as a parameter default and registered on through the parameter", async () => {
      const result = await check(`export {};`, "", {
        subRouter: `
          import { Hono } from "hono";
          import { admitHttpRead } from "../../../../platform/operationAdmission";
          import { subHealth } from "../../../../operationAdmission/readDefinitions";
          const h = async (c) => c.json({});
          function make(r = new Hono()) {
            const P = "/evil";
            r.get(P, h);
            return r;
          }
          export const sub = make();
          sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
        `,
      });
      // Line 6: the construction (a parameter default is not a binding the
      // walk opens). Line 8: the registration on the now-opaque parameter.
      expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
        [6, "`new Hono(...)`"],
        [8, ".get(...)"],
      ]);
      expect(unresolvable(result)[0].rationale).toContain("constructed in a position the walk cannot bind");
      expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
    });

    it("flags a router bound through a destructuring pattern", async () => {
      const result = await check(`export {};`, "", {
        subRouter: `
          import { Hono } from "hono";
          import { admitHttpRead } from "../../../../platform/operationAdmission";
          import { subHealth } from "../../../../operationAdmission/readDefinitions";
          const h = async (c) => c.json({});
          function make() {
            const [r] = [new Hono()];
            const P = "/evil";
            r.get(P, h);
            return r;
          }
          export const sub = make();
          sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
        `,
      });
      // Line 7: the construction inside an array literal. Line 9: the
      // registration on a binding-pattern local (opaque: any path).
      expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
        [7, "`new Hono(...)`"],
        [9, ".get(...)"],
      ]);
      expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
    });

    it("flags a router held on a class property and registered on through `this`", async () => {
      const result = await check(`export {};`, "", {
        subRouter: `
          import { Hono } from "hono";
          import { admitHttpRead } from "../../../../platform/operationAdmission";
          import { subHealth } from "../../../../operationAdmission/readDefinitions";
          const h = async (c) => c.json({});
          const P = "/evil";
          class Box {
            r = new Hono();
            build() { this.r.get(P, h); return this.r; }
          }
          export const sub = new Box().build();
          sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
        `,
      });
      // Line 8: the class-property construction. Line 9: a `this`-rooted
      // receiver is judged like a module-scoped one — any path is a route.
      expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
        [8, "`new Hono(...)`"],
        [9, ".get(...)"],
      ]);
      expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
    });

    it("flags a top-level router handed straight to a call, and a `new HttpRouterWithHono` outside a declaration", async () => {
      const result = await check(`
        import { Hono } from "hono";
        import { HttpRouterWithHono } from "convex-helpers/server/hono";
        const h = async (c) => c.json({});
        const P = "/evil";
        function install(r) { r.get(P, h); return r; }
        export const built = install(new Hono());
        export const wrapped = [new HttpRouterWithHono(built)];
      `);
      expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
        [7, "`new Hono(...)`"],
        [8, "`new HttpRouterWithHono(...)`"],
      ]);
    });

    it("keeps every real-tree spelling: `const app: HonoWithConvex<ActionCtx> = new Hono()`, `const http = new HttpRouterWithHono<ActionCtx>(app)`, `export const sub = new Hono()`", async () => {
      const result = await check(`export {};`);
      expect(result.findings).toEqual([]);
    });
  });

  describe("round 9: a `.route(prefix, child)` whose child the walk cannot open fails closed at the mount", () => {
    const mountFixture = (acquire: string) => `
      import { Hono } from "hono";
      import { admitHttpRead } from "../../../../platform/operationAdmission";
      import { subHealth } from "../../../../operationAdmission/readDefinitions";
      export const sub = new Hono();
      const h = async (c) => c.json({ pwned: true });
      const P = "/evil";
      ${acquire}
      sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
    `;
    const mountFinding = (result: Awaited<ReturnType<typeof check>>) =>
      unresolvable(result).find((finding) => finding.rationale.includes("mounts `"));

    it.each([
      ["a for-of-bound `new Hono()`", `for (const r of [new Hono()]) {\n  r.get(P, h);\n  sub.route("/x", r);\n}`],
      ["a catch-bound `new Hono()`", `try { throw new Hono(); } catch (r) {\n  r.get(P, h);\n  sub.route("/x", r);\n}`],
      ["a forEach-parameter `new Hono()`", `[new Hono()].forEach((r) => {\n  r.get(P, h);\n  sub.route("/x", r);\n});`],
    ])("flags %s mounted with .route — at the construction and at the mount", async (_label, acquire) => {
      const result = await check(`export {};`, "", { subRouter: mountFixture(acquire) });
      const findings = unresolvable(result);
      // Line 8: the construction (a loop source / thrown value / array
      // element is not a binding the walk opens). Line 10: the mount of a
      // nested-scope binding. `r.get(P, h)` on the loop / catch / parameter
      // binding keeps the string rule; the construction and the mount are
      // the two sites that close every acquisition path.
      expect(findings.map((finding) => [finding.line, finding.functionName])).toEqual([
        [8, "`new Hono(...)`"],
        [10, ".route(...)"],
      ]);
      expect(findings[0].rationale).toContain("constructed in a position the walk cannot bind");
      expect(findings[1].rationale).toContain("a name bound in a nested scope");
      expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
    });

    it("flags an ambient `declare const ghost` mounted with .route", async () => {
      const result = await check(`export {};`, "", {
        subRouter: mountFixture(`declare const ghost: any;\nsub.route("/x", ghost);`),
      });
      const findings = unresolvable(result);
      expect(findings.map((finding) => finding.functionName)).toContain("`ghost`");
      expect(findings.find((finding) => finding.functionName === "`ghost`")?.rationale).toContain("declared without an initializer");
      expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
    });

    it("flags a router imported relatively from outside convex/** and mounted with .route", async () => {
      const result = await check(`export {};`, "", {
        subRouter: mountFixture(`import { outside } from "../../../../../outside/router";\nsub.route("/x", outside);`),
      });
      const finding = mountFinding(result);
      expect(finding?.functionName).toBe(".route(...)");
      expect(finding?.rationale).toContain("mounts `outside`, which does not resolve to a router the checker walked");
      expect(finding?.filePath).toBe("packages/athena-webapp/convex/http/domains/core/routes/sub.ts");
      expect(finding?.line).toBe(9);
      expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
    });

    it("flags a mount of a name that is not an exported router of the imported module", async () => {
      const result = await check(`export {};`, "", {
        subRouter: mountFixture(`import { notARouter } from "./helpers";\nsub.route("/x", notARouter);`),
        extraModules: { "http/domains/core/routes/helpers.ts": `export const notARouter = 1;` },
      });
      expect(mountFinding(result)?.rationale).toContain("mounts `notARouter`");
    });

    it("keeps the baseline mounts: every real .route resolves to a walked router and yields zero findings", async () => {
      const result = await check(`export {};`);
      expect(result.findings).toEqual([]);
      expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
    });
  });

  describe("round 9: a named-export `HttpRouterWithHono` is router-like to the sweep", () => {
    const WRAPPED_SUB = `
      import { Hono } from "hono";
      import { HttpRouterWithHono } from "convex-helpers/server/hono";
      import { admitHttpRead } from "../../../../platform/operationAdmission";
      import { subHealth } from "../../../../operationAdmission/readDefinitions";
      export const sub = new Hono();
      sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
      export const wrapped = new HttpRouterWithHono(sub);
    `;

    it("accepts the legitimate mount of the Hono router beside the wrapper, and imports the wrapper by name without a finding", async () => {
      const result = await check(
        `import { wrapped } from "./sub";\nexport { wrapped };`,
        "",
        { subRouter: WRAPPED_SUB },
      );
      expect(result.findings).toEqual([]);
      expect(routes(result)).toEqual(["GET /health", "GET /sub/health"]);
    });

    it("flags a value-reference escape of the named-imported wrapper", async () => {
      const result = await check(
        `import { wrapped } from "./sub";\nexport const keep = wrapped;`,
        "",
        { subRouter: WRAPPED_SUB },
      );
      expect(unresolvable(result).map((finding) => [finding.line, finding.functionName])).toEqual([
        [2, "`wrapped`"],
      ]);
      expect(unresolvable(result)[0].rationale).toContain("the router `wrapped` imported from `http/domains/core/routes/sub.ts`");
    });

    it("flags a .route mount of the wrapper itself — an HttpRouterWithHono is not a Hono subtree the walk can open", async () => {
      const result = await check(`export {};`, `import { wrapped } from "./http/domains/core/routes/sub";\napp.route("/w", wrapped);`, {
        subRouter: WRAPPED_SUB,
      });
      const finding = unresolvable(result).find((entry) => entry.rationale.includes("mounts `wrapped`"));
      expect(finding?.filePath).toBe("packages/athena-webapp/convex/http.ts");
      expect(finding?.rationale).toContain("resolved key `http/domains/core/routes/sub.ts#wrapped`");
    });
  });

  it("flags a definition module that imports process / a node: builtin, reads Bun.env, or builds dynamic code", async () => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir);
    await convexFixture(
      rootDir,
      "operationAdmission/domains/u1_example_definitions.ts",
      `import { env } from "node:process";
       import os from "os";
       import type { Env } from "node:process";
       const lax = env.LAX === "1";
       const bun = Bun.env.LAX === "1";
       const dyn = new Function("return process.env.LAX")();
       const ev = eval("1");
       const late = await import("node:os");
       const req = require("child_process");
       export const writeDefinition = {
         kind: "mutation",
         functionName: "example/x:write",
         operationId: "example.x.write",
         capability: "catalog.manage",
         actors: { normalUser: "admit", sharedDemo: "deny", public: lax || bun || dyn || ev || late || req || os ? "admit" : "deny" },
       };
       export const U1_DEFINITIONS = [writeDefinition];`,
    );
    const result = await collectOperationAdmissionCheckResult(rootDir);
    const env = result.findings.filter((finding) =>
      finding.id.startsWith("definition-module-reads-environment-"),
    );
    // Lines 1, 2 (imports; the type-only import on line 3 reads nothing),
    // 5 (`Bun`), 6 (`Function`), 7 (`eval`), 8 (`import("node:os")`),
    // 9 (`require("child_process")`).
    expect(env.map((finding) => finding.line)).toEqual([1, 2, 5, 6, 7, 8, 9]);
    expect(env.every((finding) => finding.severity === "high")).toBe(true);
    expect(env[0].remediation).toContain("no import of `process` or a `node:` builtin");
  });
});

describe("round 9: router middleware is pass-through-or-deny", () => {
  const SUB_ROUTER_HEAD = `
    import { Hono } from "hono";
    import { admitHttpRead } from "../../../../platform/operationAdmission";
    import { subHealth } from "../../../../operationAdmission/readDefinitions";
    export const sub = new Hono();
  `;
  const SUB_ROUTER_TAIL = `
    sub.get("/health", admitHttpRead(subHealth, async (c) => c.json({})));
  `;
  const check = async (
    middleware: string,
    options: { extraModules?: Record<string, string>; httpTail?: string; subHead?: string } = {},
  ) => {
    const rootDir = await createFixtureRoot();
    await writeBaselineTree(rootDir, {
      reads: {
        subHealth: {
          kind: "http_read",
          route: { method: "GET", path: "/sub/health" },
          operationId: "http.sub.health",
          access: { kind: "read", intent: "platform.health.view" },
        },
      },
    });
    await convexFixture(
      rootDir,
      "http/domains/core/routes/sub.ts",
      `${options.subHead ?? SUB_ROUTER_HEAD}\n${middleware}\n${SUB_ROUTER_TAIL}`,
    );
    for (const [convexPath, source] of Object.entries(options.extraModules ?? {})) {
      await convexFixture(rootDir, convexPath, source);
    }
    await convexFixture(
      rootDir,
      "http.ts",
      `${ADMITTED_ROUTER}
        import { sub } from "./http/domains/core/routes/sub";
        app.route("/sub", sub);
        ${options.httpTail ?? ""}
      `,
    );
    return collectOperationAdmissionCheckResult(rootDir);
  };
  const middlewareFindings = (result: Awaited<ReturnType<typeof check>>) =>
    result.findings.filter((finding) =>
      finding.id.startsWith("router-middleware-not-statically-resolvable-"),
    );
  const SUB_ID = "router-middleware-not-statically-resolvable-packages-athena-webapp-convex-http-domains-core-routes-sub-ts-";
  // The real tree's verifier middleware shape (whatsapp / mtn-momo / harness
  // waivers): bounded read, verifier, 4xx denials, re-bodied request, then
  // `await next()`.
  const VERIFIER_MIDDLEWARE = `
    import { readBoundedRequestBody, requestWithBody } from "../../../../operationAdmission/ingressBody";
    import { verify } from "./verify";
    sub.use("*", async (c, next) => {
      if (c.req.method !== "POST") return next();
      let secret;
      try {
        secret = process.env.SECRET;
      } catch {
        return c.json({ error: "not configured" }, 503);
      }
      const bounded = await readBoundedRequestBody(c.req.raw, 1024);
      if (bounded.kind === "too_large") {
        return c.json({ error: "Request body too large." }, 413);
      }
      const rawBody = new TextDecoder().decode(bounded.bytes);
      const verified = await verify({ secret, rawBody, signatureHeader: c.req.header("x-sig") });
      if (!verified) {
        return c.json({ error: "Webhook verification failed" }, 401);
      }
      c.req.raw = requestWithBody(c.req.raw, bounded.bytes);
      await next();
    });
  `;
  // The real tree's factory (`http/domains/core/routes/boundedBody.ts`).
  const BOUNDED_BODY_FACTORY = `
    import type { Context, Next } from "hono";
    import { readBoundedRequestBody, requestWithBody } from "../../../../operationAdmission/ingressBody";
    export async function readBoundedBody(request: Request, maxBytes: number) {
      const result = await readBoundedRequestBody(request, maxBytes);
      return result.kind === "too_large" ? null : result.bytes;
    }
    export function boundRequestBody(resolveMaxBytes: () => number) {
      return async (c: Context, next: Next) => {
        let maxBytes: number;
        try {
          maxBytes = resolveMaxBytes();
        } catch {
          return next();
        }
        const bytes = await readBoundedBody(c.req.raw, maxBytes);
        if (bytes === null) {
          return c.json({ error: { code: "request_rejected" } }, 413);
        }
        c.req.raw = requestWithBody(c.req.raw, bytes);
        return next();
      };
    }
  `;

  it("passes the baseline: `app.use(\"*\", cors(...))` in http.ts and no other middleware", async () => {
    const result = await check("");
    expect(result.findings).toEqual([]);
  });

  it("flags a path-scoped `.use` whose handler never calls next() — the closed round-8 residual", async () => {
    const result = await check(`sub.use("/evil", async (c) => c.json({ pwned: true }));`);
    expect(result.findings.map((finding) => finding.id)).toEqual([`${SUB_ID}7`]);
    const [finding] = middlewareFindings(result);
    expect(finding.severity).toBe("high");
    expect(finding.functionName).toBe(".use(...)");
    expect(finding.rationale).toContain("declares 1 parameter(s)");
    expect(finding.rationale).toContain("terminal, unadmitted responder");
    expect(finding.remediation).toContain("ends with `await next()`");
  });

  it.each([
    ["an identifier handler", `const h = async (c, next) => { await next(); };\nsub.use("*", h);`, "only an inline"],
    ["a handler-only `.use(fn)`", `sub.use(async (c, next) => { await next(); });`, "called with 1 argument(s)"],
    ["a third argument", `sub.use("*", async (c, next) => { await next(); }, async (c, next) => { await next(); });`, "called with 3 argument(s)"],
    ["a non-literal path", `const P = "/evil";\nsub.use(P, async (c, next) => { await next(); });`, "not a string literal"],
    ["a 2xx response", `sub.use("*", async (c, next) => { if (c.req.method === "GET") return c.json({ pwned: true }, 200); await next(); });`, "returns something other than"],
    ["a non-literal status", `const ok = 200;\nsub.use("*", async (c, next) => { if (c.req.method === "GET") return c.json({}, ok); await next(); });`, "returns something other than"],
    ["a bare return", `sub.use("*", async (c, next) => { if (c.req.method === "GET") return; await next(); });`, "returns something other than"],
    ["a body that does not end in next()", `sub.use("*", async (c, next) => { await next(); c.req.raw = c.req.raw; });`, "last statement is"],
    ["an expression body", `sub.use("*", async (c, next) => next());`, "expression-bodied"],
    ["reading c.env before admission", `sub.use("*", async (c, next) => { await c.env.runMutation("x"); await next(); });`, "`c.env` is not an accepted member"],
    ["writing c.res", `sub.use("*", async (c, next) => { c.res = new Response("pwned"); await next(); });`, "`c.res` is not an accepted member"],
    ["c.json outside a return", `sub.use("*", async (c, next) => { c.json({ pwned: true }, 401); await next(); });`, "used other than as `return c.json"],
    ["c passed as a value", `import { respond } from "./respond";\nsub.use("*", async (c, next) => { respond(c); await next(); });`, "`c` is used other than as"],
    ["c under a cast", `sub.use("*", async (c, next) => { (c as any).env; await next(); });`, "`c` is used other than as"],
    ["c through a computed member", `sub.use("*", async (c, next) => { c["env"]; await next(); });`, "`c` is used other than as"],
    ["next() inside a try", `sub.use("*", async (c, next) => { try { await next(); } catch {} return next(); });`, "may only be `return next()`"],
    ["next() called twice", `sub.use("*", async (c, next) => { await next(); await next(); });`, "may only be `return next()`"],
    ["next stored", `sub.use("*", async (c, next) => { const n = next; await n(); await next(); });`, "used other than as the callee"],
    ["next with an argument", `sub.use("*", async (c, next) => { await next(c); await next(); });`, "used other than as the callee"],
    ["next() as the last statement with an argument", `sub.use("*", async (c, next) => { await next(c); });`, "last statement is"],
    ["next() from a nested expression-bodied function", `sub.use("*", async (c, next) => { const go = () => next(); await go(); return next(); });`, "may only be `return next()`"],
    ["next() from a nested block function", `sub.use("*", async (c, next) => { const go = () => { return next(); }; await go(); return next(); });`, "nested function"],
    ["a return inside a nested function", `sub.use("*", async (c, next) => { [1].map((x) => { return x; }); await next(); });`, "inside a nested function"],
    ["a destructured parameter", `sub.use("*", async ({ req }, next) => { await next(); });`, "not a plain identifier"],
    ["a rest parameter", `sub.use("*", async (c, ...rest) => { await rest[0](); });`, "not a plain identifier"],
    ["a redeclared parameter", `sub.use("*", async (c, next) => { { const c = 1; } await next(); });`, "redeclares its `c` parameter"],
    ["`arguments`", `sub.use("*", async function (c, next) { arguments[0].env; await next(); });`, "references `arguments`"],
    ["`this`", `sub.use("*", async function (c, next) { this.x; await next(); });`, "reads `this`"],
    ["a thrown HTTPException(200, { res }) — Hono renders getResponse() as the response", `import { HTTPException } from "hono/http-exception";\nsub.use("*", async (c, next) => { const body = await c.req.text(); throw new HTTPException(200, { res: new Response(JSON.stringify({ pwned: true, echo: body })) }); await next(); });`, "throws a value it constructs or obtains"],
    ["a thrown Error carrying getResponse", `sub.use("*", async (c, next) => { if (c.req.method === "GET") throw Object.assign(new Error("x"), { getResponse: () => new Response("served", { status: 200 }) }); await next(); });`, "throws a value it constructs or obtains"],
    ["a thrown plain `new Error(...)`", `sub.use("*", async (c, next) => { if (!c.req.header("x")) throw new Error("missing"); await next(); });`, "throws a value it constructs or obtains"],
    ["a thrown call result", `import { deny } from "./deny";\nsub.use("*", async (c, next) => { throw deny(); await next(); });`, "throws a value it constructs or obtains"],
    ["a rethrow of a REBOUND catch binding", `import { HTTPException } from "hono/http-exception";\nsub.use("*", async (c, next) => { try { c.req.header("x"); } catch (error) { error = new HTTPException(200, { res: new Response("pwned") }); throw error; } await next(); });`, "throws a value it constructs or obtains"],
    ["a throw of an outer local, not the catch binding", `sub.use("*", async (c, next) => { let saved; try { c.req.header("x"); } catch (error) { saved = error; } if (saved) throw saved; await next(); });`, "throws a value it constructs or obtains"],
    ["`try { return next() } catch` — observing the admitted handler's failure", `sub.use("*", async (c, next) => { try { return next(); } catch (e) { return c.json({ leaked: String(e) }, 500); } await next(); });`, "called inside a `try`"],
    ["`return next()` inside a try's finally", `sub.use("*", async (c, next) => { try { c.req.header("x"); } finally { return next(); } await next(); });`, "called inside a `try`"],
    ["a generator middleware", `sub.use("*", async function* (c, next) { await next(); });`, "is a generator function"],
    ["a factory the checker cannot open", `import { mw } from "../../../../lib/mw";\nsub.use("*", mw());`, "not a named import of a convex module under `http/`"],
    ["a factory reached through a member", `import * as mws from "./mws";\nsub.use("*", mws.mw());`, "only the `hono/cors` factory or a named-import factory"],
    ["a factory called optionally", `import { mw } from "./mws";\nsub.use("*", mw?.());`, "only an inline"],
  ])("flags %s", async (_label, middleware, reason) => {
    const result = await check(middleware);
    const findings = middlewareFindings(result);
    expect(findings.map((finding) => finding.severity)).toEqual(["high"]);
    expect(findings[0].rationale).toContain(reason);
  });

  it("accepts the real tree's verifier middleware shape (bounded read, verifier, 4xx denials, re-bodied request, await next())", async () => {
    const result = await check(VERIFIER_MIDDLEWARE, {
      extraModules: {
        "http/domains/core/routes/verify.ts": `export async function verify() { return true; }`,
        "operationAdmission/ingressBody.ts": `export async function readBoundedRequestBody() { return { kind: "ok", bytes: new Uint8Array() }; }\nexport function requestWithBody(r) { return r; }`,
      },
    });
    expect(result.findings).toEqual([]);
  });

  it("accepts the real tree's harness-waiver shape: authorize in a try, deny the typed fault, rethrow the catch binding, then await next()", async () => {
    const result = await check(`
      import { authorized, isWaiverConfigurationError } from "./waiverAuth";
      sub.use("*", async (c, next) => {
        try {
          if (!(await authorized(c.req.header("authorization")))) {
            return c.json({ error: { code: "unauthorized" } }, 401);
          }
        } catch (error) {
          if (isWaiverConfigurationError(error)) {
            return c.json({ error: { code: "temporarily_unavailable" } }, 503);
          }
          throw error;
        }
        await next();
      });
    `, {
      extraModules: {
        "http/domains/core/routes/waiverAuth.ts": `export async function authorized() { return true; }\nexport function isWaiverConfigurationError() { return false; }`,
      },
    });
    expect(result.findings).toEqual([]);
  });

  it("accepts `return next()` inside a catch clause (the real boundRequestBody shape) — a catch does not observe the admitted handler", async () => {
    const result = await check(`
      sub.use("*", async (c, next) => {
        try {
          c.req.header("x");
        } catch {
          return next();
        }
        await next();
      });
    `);
    expect(result.findings).toEqual([]);
  });

  describe("the root router's error handler is fixed (`assertRootErrorHandler`)", () => {
    const withoutOnError = (source: string) =>
      source.replace(`app.onError((err, c) => c.json({ error: "internal" }, 500));`, "");
    const checkHttp = async (onErrorLine: string, middleware = "") => {
      const rootDir = await createFixtureRoot();
      await writeBaselineTree(rootDir, {
        reads: {
          subHealth: {
            kind: "http_read",
            route: { method: "GET", path: "/sub/health" },
            operationId: "http.sub.health",
            access: { kind: "read", intent: "platform.health.view" },
          },
        },
      });
      await convexFixture(
        rootDir,
        "http/domains/core/routes/sub.ts",
        `${SUB_ROUTER_HEAD}\n${middleware}\n${SUB_ROUTER_TAIL}`,
      );
      await convexFixture(
        rootDir,
        "http.ts",
        `${withoutOnError(ADMITTED_ROUTER)}
          import { sub } from "./http/domains/core/routes/sub";
          app.route("/sub", sub);
          ${onErrorLine}
        `,
      );
      return collectOperationAdmissionCheckResult(rootDir);
    };
    const handlerFindings = (result: Awaited<ReturnType<typeof checkHttp>>) =>
      result.findings.filter(
        (finding) =>
          finding.id === "router-error-handler-not-fixed" ||
          finding.id.startsWith("error-handler-outside-router-module-"),
      );

    it("passes the fixed shape (block body, expression body, c.text, any 5xx literal, any parameter names)", async () => {
      for (const line of [
        `app.onError((err, c) => c.json({ error: "internal" }, 500));`,
        `app.onError((err, c) => { return c.json({ error: "internal" }, 500); });`,
        `app.onError((error, ctx) => ctx.text("Internal Server Error", 503));`,
      ]) {
        const result = await checkHttp(line);
        expect(result.findings, line).toEqual([]);
      }
    });

    it("flags a missing root error handler — Hono's default renders getResponse() errors as the response", async () => {
      const result = await checkHttp("");
      expect(handlerFindings(result).map((finding) => finding.id)).toEqual(["router-error-handler-not-fixed"]);
      expect(handlerFindings(result)[0].severity).toBe("high");
      expect(handlerFindings(result)[0].rationale).toContain("registers 0 `.onError(...)` handler(s)");
      expect(handlerFindings(result)[0].rationale).toContain("getResponse()");
      expect(handlerFindings(result)[0].remediation).toContain('app.onError((err, c) => c.json({ error: "internal" }, 500));');
    });

    it.each([
      ["a handler that renders the thrown value", `app.onError((err, c) => err.getResponse());`, "must be exactly `return c.json(<body>, <literal 5xx>)`"],
      ["a handler that passes the error into the body", `app.onError((err, c) => c.json({ error: err }, 500));`, "references its error parameter `err`"],
      ["a handler that mentions the error's message", `app.onError((err, c) => c.json({ error: err.message }, 500));`, "references its error parameter `err`"],
      ["a non-5xx status", `app.onError((err, c) => c.json({ ok: true }, 200));`, "must be exactly `return c.json(<body>, <literal 5xx>)`"],
      ["a non-literal status", `const s = 500;\napp.onError((err, c) => c.json({}, s));`, "must be exactly `return c.json(<body>, <literal 5xx>)`"],
      ["a second statement", `app.onError((err, c) => { console.log("x"); return c.json({}, 500); });`, "must be exactly `return c.json(<body>, <literal 5xx>)`"],
      ["a handler identifier", `const onError = (err, c) => c.json({}, 500);\napp.onError(onError);`, "only an inline `(err, c) => ...` arrow is accepted"],
      ["a one-parameter handler", `app.onError((err) => new Response("x", { status: 500 }));`, "exactly two plain identifier parameters"],
      ["a `this`-reading handler", `app.onError((err, c) => c.json({ x: this }, 500));`, "contains a nested function or `this`"],
      ["a nested function in the body", `app.onError((err, c) => c.json({ x: [1].map((n) => n) }, 500));`, "contains a nested function or `this`"],
      ["c used elsewhere in the body", `app.onError((err, c) => c.json({ env: c.env }, 500));`, "uses `c` other than as"],
      ["two handlers", `app.onError((err, c) => c.json({}, 500));\napp.onError((err, c) => c.json({}, 500));`, "registers 2 `.onError(...)` handler(s)"],
      ["a handler on the HttpRouterWithHono wrapper, not the Hono router", `http.onError((err, c) => c.json({}, 500));`, "not a top-level Hono router of the module"],
      ["a handler registered inside a function", `function install() { app.onError((err, c) => c.json({}, 500)); }\ninstall();`, "not as a top-level statement"],
    ])("flags %s", async (_label, line, reason) => {
      const result = await checkHttp(line);
      expect(handlerFindings(result).map((finding) => finding.id)).toEqual(["router-error-handler-not-fixed"]);
      expect(handlerFindings(result)[0].rationale).toContain(reason);
    });

    it("flags `.onError` on a sub-router — it renders before the root handler", async () => {
      const result = await checkHttp(
        `app.onError((err, c) => c.json({ error: "internal" }, 500));`,
        `sub.onError((err, c) => err.getResponse());`,
      );
      expect(handlerFindings(result).map((finding) => finding.id)).toEqual([
        "error-handler-outside-router-module-http-domains-core-routes-sub-ts",
      ]);
      expect(handlerFindings(result)[0].line).toBe(7);
      expect(handlerFindings(result)[0].severity).toBe("high");
    });

    it("the real http.ts installs the fixed handler exactly once and no other real module installs one", async () => {
      const source = await readFile(
        path.join(process.cwd(), "packages/athena-webapp/convex/http.ts"),
        "utf8",
      );
      const assertion = assertRootErrorHandler("packages/athena-webapp/convex/http.ts", source);
      expect(assertion.fixed).toBe(true);
      expect(assertion.sites).toHaveLength(1);
      expect(source).toContain(`app.onError((err, c) => c.json({ error: "internal" }, 500));`);
    });
  });

  it("accepts a function-expression middleware and `return await next()`", async () => {
    const result = await check(`
      sub.use("*", async function (c, next) {
        if (!c.req.header("authorization")) return c.text("unauthorized", 401);
        return await next();
      });
    `);
    expect(result.findings).toEqual([]);
  });

  it("accepts the real tree's `boundRequestBody(...)` factory from a convex module under http/ and judges its returned middleware", async () => {
    const accepted = await check(
      `import { boundRequestBody } from "./boundedBody";\nsub.use("*", boundRequestBody(() => 1024));`,
      {
        extraModules: {
          "http/domains/core/routes/boundedBody.ts": BOUNDED_BODY_FACTORY,
          "operationAdmission/ingressBody.ts": `export async function readBoundedRequestBody() { return { kind: "ok", bytes: new Uint8Array() }; }\nexport function requestWithBody(r) { return r; }`,
        },
      },
    );
    expect(accepted.findings).toEqual([]);

    // The same factory whose returned middleware answers 200 fails at the
    // `.use` site, naming the factory and the line of the offending function.
    const leaking = await check(
      `import { boundRequestBody } from "./boundedBody";\nsub.use("*", boundRequestBody(() => 1024));`,
      {
        extraModules: {
          "http/domains/core/routes/boundedBody.ts": BOUNDED_BODY_FACTORY.replace(
            `return c.json({ error: { code: "request_rejected" } }, 413);`,
            `return c.json({ pwned: true }, 200);`,
          ),
          "operationAdmission/ingressBody.ts": `export async function readBoundedRequestBody() { return { kind: "ok", bytes: new Uint8Array() }; }\nexport function requestWithBody(r) { return r; }`,
        },
      },
    );
    expect(middlewareFindings(leaking).map((finding) => finding.id)).toEqual([`${SUB_ID}8`]);
    expect(middlewareFindings(leaking)[0].rationale).toContain("the middleware returned by `boundRequestBody` (`http/domains/core/routes/boundedBody.ts:");
    expect(middlewareFindings(leaking)[0].rationale).toContain("returns something other than");
  });

  it.each([
    ["a factory that is not exactly one returned function", `export function mw(n) { const x = n; return async (c, next) => { await next(); }; }`, "does not consist of exactly one returned"],
    ["a factory that returns a call", `export function mw(n) { return other(n); }`, "does not consist of exactly one returned"],
    ["a factory re-exported under another name", `const inner = (n) => async (c, next) => { await next(); };\nexport { inner as mw };`, "not an `export function` / `export const`"],
    ["a factory that is missing", `export const other = 1;`, "not an `export function` / `export const`"],
  ])("flags %s", async (_label, factoryModule, reason) => {
    const result = await check(
      `import { mw } from "./mws";\nsub.use("*", mw(1));`,
      { extraModules: { "http/domains/core/routes/mws.ts": factoryModule } },
    );
    expect(middlewareFindings(result).map((finding) => finding.line)).toEqual([8]);
    expect(middlewareFindings(result)[0].rationale).toContain(reason);
  });

  it("accepts an expression-bodied `export const` factory whose returned middleware passes", async () => {
    const result = await check(
      `import { mw } from "./mws";\nsub.use("*", mw(1));`,
      { extraModules: { "http/domains/core/routes/mws.ts": `export const mw = (n: number) => async (c, next) => { if (n < 0) return c.json({}, 400); await next(); };` } },
    );
    expect(result.findings).toEqual([]);
  });

  it("accepts `cors(...)` as the `.use` handler only through the CORS assertion — outside http.ts it is the existing cors-outside-router finding, not a middleware finding", async () => {
    const result = await check(
      `import { cors } from "hono/cors";\nimport { STOREFRONT_ALLOWED_ORIGINS } from "../../../../platform/storefrontOrigins";\nsub.use("*", cors({ origin: STOREFRONT_ALLOWED_ORIGINS }));`,
    );
    expect(middlewareFindings(result)).toEqual([]);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "cors-middleware-outside-router-module-http-domains-core-routes-sub-ts",
    ]);
  });

  it("does not accept a local function named `cors` as the CORS middleware", async () => {
    const result = await check(`const cors = () => async (c) => c.json({ pwned: true });\nsub.use("*", cors());`);
    expect(middlewareFindings(result).map((finding) => finding.line)).toEqual([8]);
    expect(middlewareFindings(result)[0].rationale).toContain("not a named import of a convex module under `http/`");
  });

  it("judges `.use` reached through a literal element access, and fails `.call` / computed spellings as router escapes", async () => {
    // A literal bracket callee is the same call to the walk (judged by the
    // grammar) AND a router escape to the reference sweep (round 7), exactly
    // as `sub["get"](...)` is.
    const bracket = await check(`sub["use"]("/evil", async (c) => c.json({ pwned: true }));`);
    expect(bracket.findings.map((finding) => finding.id)).toEqual([
      "route-registration-not-statically-resolvable-packages-athena-webapp-convex-http-domains-core-routes-sub-ts-7",
      `${SUB_ID}7`,
    ]);

    const call = await check(`sub.use.call(sub, "/evil", async (c) => c.json({ pwned: true }));`);
    expect(call.findings.map((finding) => finding.id)).toEqual([
      "route-registration-not-statically-resolvable-packages-athena-webapp-convex-http-domains-core-routes-sub-ts-7",
    ]);
    expect(call.findings[0].rationale).toContain("`.call` / `.apply`");

    const computed = await check(`const m = "use";\nsub[m]("/evil", async (c) => c.json({ pwned: true }));`);
    expect(computed.findings.map((finding) => finding.id)).toEqual([
      "route-registration-not-statically-resolvable-packages-athena-webapp-convex-http-domains-core-routes-sub-ts-8",
    ]);
  });

  it("flags a second `.use` in http.ts beside the accepted cors() registration", async () => {
    const result = await check("", {
      httpTail: `app.use("/evil", async (c) => c.json({ pwned: true }));`,
    });
    expect(middlewareFindings(result).map((finding) => finding.filePath)).toEqual([
      "packages/athena-webapp/convex/http.ts",
    ]);
  });
});

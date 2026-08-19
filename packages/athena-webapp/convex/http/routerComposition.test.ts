import { Hono } from "hono";
import { cors } from "hono/cors";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isAllowedStorefrontOrigin } from "../platform/storefrontOrigins";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("http router composition", () => {
  it("registers Convex auth routes on the shared Hono-backed router instead of bridging through http.lookup", () => {
    const httpRouter = readProjectFile("convex", "http.ts");

    expect(httpRouter).toContain(
      "const http = new HttpRouterWithHono<ActionCtx>(app);"
    );
    expect(httpRouter).toContain("auth.addHttpRoutes(http);");
    expect(httpRouter).not.toContain("http.lookup(");
    expect(httpRouter).not.toContain(
      'app.get("/.well-known/openid-configuration"'
    );
    expect(httpRouter).not.toContain('app.get("/.well-known/jwks.json"');
    expect(httpRouter).not.toContain('app.get("/api/auth/signin/*"');
    expect(httpRouter).not.toContain(
      'app.on(["GET", "POST"], "/api/auth/callback/*"'
    );
    expect(httpRouter).toContain("export default http;");
  });

  it("keeps the auth route family registered before the CORS middleware", () => {
    const httpRouter = readProjectFile("convex", "http.ts");

    // Convex Auth is the trust root that mints the principals the adapters
    // resolve, so its route family is the one non-admitted surface. It is
    // installed once, from this module, ahead of the middleware.
    expect(httpRouter.indexOf("auth.addHttpRoutes(http);")).toBeGreaterThan(-1);
    expect(httpRouter.indexOf("auth.addHttpRoutes(http);")).toBeLessThan(
      httpRouter.indexOf("cors({"),
    );
    expect(httpRouter.match(/auth\.addHttpRoutes\(/g)).toHaveLength(1);
  });

  it("sources CORS from the fixed storefront allowlist rather than reflecting the request origin", () => {
    const httpRouter = readProjectFile("convex", "http.ts");

    expect(httpRouter).toContain(
      "origin: [...readStorefrontOriginAllowlist()],",
    );
    expect(httpRouter).toContain("credentials: true,");
    // The reflect-any-origin callback is what made every credentialed customer
    // route reachable cross-origin; it must not come back in any form.
    expect(httpRouter).not.toMatch(/origin:\s*\(origin\)/);
    expect(httpRouter).not.toMatch(/origin:\s*"\*"/);
  });

  it("fails closed on the allowlist itself", () => {
    // Hono emits no Access-Control-Allow-Origin for an origin the array does
    // not contain, and appends `Vary: Origin` for every non-wildcard config —
    // so the whole boundary rests on this predicate.
    const environment = {
      ATHENA_STOREFRONT_ALLOWED_ORIGINS: "https://wigclub.store",
    };

    expect(isAllowedStorefrontOrigin("https://wigclub.store", environment)).toBe(
      true,
    );
    expect(isAllowedStorefrontOrigin("https://evil.example", environment)).toBe(
      false,
    );
    expect(isAllowedStorefrontOrigin("null", environment)).toBe(false);
    expect(isAllowedStorefrontOrigin(undefined, environment)).toBe(false);
    expect(isAllowedStorefrontOrigin("https://wigclub.store", {})).toBe(false);
  });

  /**
   * The `Vary: Origin` guarantee, pinned behaviourally.
   *
   * The response varies by request origin, so without this header a shared
   * cache can serve one origin's `Access-Control-Allow-Origin` to another —
   * the allowlist becomes a cache-poisoning primitive. Hono's `cors()` appends
   * it for every non-wildcard configuration, which ours always is.
   *
   * That is a dependency on library behaviour, so it is asserted here rather
   * than restated by a second middleware. An earlier attempt at "stating it
   * explicitly" appended it twice and shipped `Vary: Origin, Origin`; a
   * duplicated header is not a stronger guarantee. This test is what makes a
   * silent library change fail loudly — including the exactly-once part.
   */
  it("sends Vary: Origin exactly once on a CORS-eligible response", async () => {
    const app = new Hono();
    app.use(
      "*",
      cors({
        origin: ["https://wigclub.store"],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        credentials: true,
      }),
    );
    app.get("/probe", (c) => c.json({ ok: true }));

    const response = await app.fetch(
      new Request("https://api.test/probe", {
        headers: { Origin: "https://wigclub.store" },
      }),
    );

    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://wigclub.store",
    );
  });

  it("names no second Vary middleware in the router", () => {
    // The duplicate-append regression, pinned at the source it came from.
    const httpRouter = readProjectFile("convex", "http.ts");
    expect(httpRouter).not.toContain('headers.append("Vary"');
  });

  it("admits the health probe through the read wrapper", () => {
    const httpRouter = readProjectFile("convex", "http.ts");

    expect(httpRouter).toContain(
      "admitHttpRead(healthRouteReadDefinition,",
    );
  });

  it("installs the fixed root error handler exactly once", () => {
    const httpRouter = readProjectFile("convex", "http.ts");

    expect(
      httpRouter.match(
        /app\.onError\(\(err, c\) => c\.json\(\{ error: "internal" \}, 500\)\);/g,
      ),
    ).toHaveLength(1);
    expect(httpRouter.match(/\.onError\(/g)).toHaveLength(1);
  });

  /**
   * The premise behind the fixed handler, pinned behaviourally.
   *
   * Hono's default error handler renders any thrown value that carries
   * `getResponse()` — an `HTTPException(200, { res })` — as THAT response,
   * with the status it names. A `throw` from a router middleware is therefore
   * a response channel that bypasses admission unless the root handler is
   * fixed. This test is what makes a silent library change (or a dropped
   * `app.onError`) fail loudly.
   */
  it("renders a thrown getResponse()-bearing error as the fixed 5xx, not as the response it carries", async () => {
    const { HTTPException } = await import("hono/http-exception");
    const build = (fixed: boolean) => {
      const root = new Hono();
      if (fixed) {
        root.onError((err, c) => c.json({ error: "internal" }, 500));
      }
      const sub = new Hono();
      sub.use("*", async (c, next) => {
        throw new HTTPException(200, {
          res: new Response(JSON.stringify({ pwned: c.req.path }), {
            status: 200,
          }),
        });
        await next();
      });
      sub.get("/probe", (c) => c.json({ ok: true }));
      root.route("/sub", sub);
      return root;
    };
    const request = () => new Request("https://api.test/sub/probe");

    // Without the handler the thrown value IS the response.
    expect((await build(false).fetch(request())).status).toBe(200);
    // With it, every thrown value renders as the same 5xx.
    const fixed = await build(true).fetch(request());
    expect(fixed.status).toBe(500);
    expect(await fixed.json()).toEqual({ error: "internal" });
  });
});

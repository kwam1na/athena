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

  it("admits the health probe through the read wrapper", () => {
    const httpRouter = readProjectFile("convex", "http.ts");

    expect(httpRouter).toContain(
      "admitHttpRead(healthRouteReadDefinition,",
    );
  });
});

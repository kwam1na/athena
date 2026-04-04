import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
});

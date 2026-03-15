// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

type LoadOptions = {
  cookies?: Record<string, string | undefined>;
  claims?: {
    actorId: string;
    actorType?: "guest" | "user" | "system";
    organizationId: string;
    storeId: string;
  } | null;
};

async function loadRoutes(options: LoadOptions = {}) {
  vi.resetModules();

  const getCookie = vi.fn((_: unknown, name: string) => options.cookies?.[name]);
  const getActorClaims = vi.fn().mockResolvedValue(options.claims ?? null);

  vi.doMock("hono/cookie", () => ({
    getCookie,
  }));
  vi.doMock("./actorAuth", () => ({
    getActorClaims,
  }));

  const module = await import("./me");
  const app = new Hono();
  app.route("/me", module.meRoutes);

  return { app, getActorClaims };
}

describe("meRoutes actor fallback and errors", () => {
  it("uses actor user id when cookie user id is missing", async () => {
    const { app } = await loadRoutes({
      claims: {
        actorId: "user_actor_1",
        actorType: "user",
        organizationId: "org_1",
        storeId: "store_1",
      },
    });

    const runQuery = vi.fn().mockResolvedValue({ _id: "user_actor_1" });
    const response = await app.request(
      "http://localhost/me",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ _id: "user_actor_1" });
    expect(runQuery.mock.calls[0]?.[1]).toEqual({ id: "user_actor_1" });
  });

  it("returns 400 when profile lookup query throws", async () => {
    const { app } = await loadRoutes({
      cookies: { user_id: "user_1" },
      claims: null,
    });

    const response = await app.request(
      "http://localhost/me",
      { method: "GET" },
      {
        runMutation: vi.fn(),
        runQuery: vi.fn().mockRejectedValue(new Error("query fail")),
      } as never
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "query fail" });
  });

  it("updates via actor user id when cookie is missing", async () => {
    const { app } = await loadRoutes({
      claims: {
        actorId: "user_actor_2",
        actorType: "user",
        organizationId: "org_1",
        storeId: "store_1",
      },
    });
    const runMutation = vi.fn().mockResolvedValue({ _id: "user_actor_2" });

    const response = await app.request(
      "http://localhost/me",
      {
        method: "PUT",
        body: JSON.stringify({
          email: "ada@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "5555551234",
        }),
      },
      { runMutation, runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        id: "user_actor_2",
      })
    );
  });
});

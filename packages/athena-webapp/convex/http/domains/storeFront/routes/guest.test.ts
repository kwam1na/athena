// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

type Claims = {
  actorId: string;
  actorType?: "guest" | "user" | "system";
  organizationId: string;
  storeId: string;
};

type LoadGuestRoutesOptions = {
  claims?: Claims | null;
  cookies?: Record<string, string | undefined>;
  storeData?: {
    storeId?: string;
    organizationId?: string;
  };
};

async function loadGuestRoutes(options: LoadGuestRoutesOptions = {}) {
  vi.resetModules();

  const getCookie = vi.fn(
    (_: unknown, name: string) => options.cookies?.[name]
  );
  const setCookie = vi.fn();
  const deleteCookie = vi.fn();
  const getActorClaims = vi.fn().mockResolvedValue(options.claims ?? null);
  const getStoreDataFromRequest = vi.fn().mockResolvedValue(
    options.storeData ?? {
      storeId: "store_1",
      organizationId: "org_1",
    }
  );

  vi.doMock("hono/cookie", () => ({
    getCookie,
    setCookie,
    deleteCookie,
  }));

  vi.doMock("./actorAuth", () => ({
    getActorClaims,
  }));

  vi.doMock("../../../utils", () => ({
    getStoreDataFromRequest,
  }));

  const module = await import("./guest");
  const app = new Hono();
  app.route("/guest", module.guestRoutes);

  return {
    app,
    deleteCookie,
    getActorClaims,
    getCookie,
    getStoreDataFromRequest,
    setCookie,
  };
}

describe("guestRoutes actor fallback", () => {
  it("uses actor guest claims when guest cookie is missing", async () => {
    const { app, setCookie } = await loadGuestRoutes({
      claims: {
        actorId: "guest_actor_1",
        actorType: "guest",
        organizationId: "org_1",
        storeId: "store_1",
      },
    });
    const runQuery = vi.fn().mockResolvedValue({
      _id: "guest_actor_1",
      firstName: "Ada",
    });

    const response = await app.request(
      "http://localhost/guest?marker=marker_1",
      {
        method: "GET",
      },
      {
        runMutation: vi.fn(),
        runQuery,
      } as never
    );

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls[0]?.[1]).toEqual({
      id: "guest_actor_1",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      _id: "guest_actor_1",
      firstName: "Ada",
    });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("returns 404 when no guest cookie exists and actor is not a guest", async () => {
    const { app } = await loadGuestRoutes({
      claims: {
        actorId: "user_1",
        actorType: "user",
        organizationId: "org_1",
        storeId: "store_1",
      },
    });
    const env = {
      runMutation: vi.fn(),
      runQuery: vi.fn(),
    };

    const response = await app.request(
      "http://localhost/guest",
      {
        method: "GET",
      },
      env as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Guest id missing",
    });
    expect(env.runQuery).not.toHaveBeenCalled();
    expect(env.runMutation).not.toHaveBeenCalled();
  });

  it("falls back to marker lookup and sets guest cookie when actor id validation fails", async () => {
    const { app, setCookie } = await loadGuestRoutes({
      claims: {
        actorId: "guest_actor_2",
        actorType: "guest",
        organizationId: "org_1",
        storeId: "store_1",
      },
    });
    const runQuery = vi
      .fn()
      .mockRejectedValueOnce(new Error("ArgumentValidationError: bad id"))
      .mockResolvedValueOnce(null);
    const runMutation = vi.fn().mockResolvedValue({
      _id: "guest_created_1",
      marker: "marker_2",
    });

    const response = await app.request(
      "http://localhost/guest?marker=marker_2",
      {
        method: "GET",
      },
      {
        runMutation,
        runQuery,
      } as never
    );

    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery.mock.calls[1]?.[1]).toEqual({
      marker: "marker_2",
    });

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      creationOrigin: "storefront",
      marker: "marker_2",
      organizationId: "org_1",
      storeId: "store_1",
    });

    expect(setCookie).toHaveBeenCalledTimes(1);
    expect(setCookie.mock.calls[0]?.[1]).toBe("guest_id");
    expect(setCookie.mock.calls[0]?.[2]).toBe("guest_created_1");
    expect(setCookie.mock.calls[0]?.[3]).toMatchObject({
      domain: "wigclub.store",
      httpOnly: true,
      maxAge: 90 * 24 * 60 * 60,
      path: "/",
      sameSite: "None",
      secure: true,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      _id: "guest_created_1",
      marker: "marker_2",
    });
  });

  it("updates guest details using actor guest claims when guest cookie is missing", async () => {
    const { app } = await loadGuestRoutes({
      claims: {
        actorId: "guest_actor_3",
        actorType: "guest",
        organizationId: "org_1",
        storeId: "store_1",
      },
    });
    const runMutation = vi.fn().mockResolvedValue({
      _id: "guest_actor_3",
      firstName: "Ada",
      lastName: "Lovelace",
    });

    const response = await app.request(
      "http://localhost/guest",
      {
        method: "PUT",
        body: JSON.stringify({
          email: "ada@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "5555551234",
        }),
      },
      {
        runMutation,
        runQuery: vi.fn(),
      } as never
    );

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      email: "ada@example.com",
      firstName: "Ada",
      id: "guest_actor_3",
      lastName: "Lovelace",
      phoneNumber: "5555551234",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      _id: "guest_actor_3",
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("creates a guest on POST /", async () => {
    const { app } = await loadGuestRoutes();
    const runMutation = vi.fn().mockResolvedValue("guest_created_99");

    const response = await app.request(
      "http://localhost/guest",
      {
        method: "POST",
      },
      {
        runMutation,
        runQuery: vi.fn(),
      } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "guest_created_99" });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({});
  });

  it("updates with undefined actor guest id when actor is not guest", async () => {
    const { app } = await loadGuestRoutes({
      claims: {
        actorId: "user_1",
        actorType: "user",
        organizationId: "org_1",
        storeId: "store_1",
      },
    });
    const runMutation = vi.fn().mockResolvedValue({ success: true });

    const response = await app.request(
      "http://localhost/guest",
      {
        method: "PUT",
        body: JSON.stringify({
          email: "ada@example.com",
        }),
      },
      { runMutation, runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      email: "ada@example.com",
      firstName: undefined,
      id: undefined,
      lastName: undefined,
      phoneNumber: undefined,
    });
  });
});

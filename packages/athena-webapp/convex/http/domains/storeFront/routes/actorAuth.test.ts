// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeContext = {
  req: {
    header: (name: string) => string | undefined;
    param: (name: string) => string | undefined;
  };
  json: ReturnType<typeof vi.fn>;
};

function createContext({
  headers = {},
  params = {},
}: {
  headers?: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
} = {}): FakeContext {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
      param: (name: string) => params[name],
    },
    json: vi.fn((body, status) => ({ body, status })),
  };
}

async function loadModule(signingKey?: string) {
  vi.resetModules();

  const jwtVerify = vi.fn();

  vi.doMock("jose", () => ({
    jwtVerify,
  }));

  vi.doMock("../../../../env", () => ({
    STOREFRONT_ACTOR_SIGNING_KEY: signingKey,
  }));

  const module = await import("./actorAuth");

  return {
    enforceActorAccess: module.enforceActorAccess,
    jwtVerify,
  };
}

describe("enforceActorAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500 when the signing key is missing", async () => {
    const { enforceActorAccess } = await loadModule();
    const context = createContext();

    const response = await enforceActorAccess(context as never);

    expect(context.json).toHaveBeenCalledWith(
      { error: "Storefront actor signing key is not configured." },
      500
    );
    expect(response).toEqual({
      body: { error: "Storefront actor signing key is not configured." },
      status: 500,
    });
  });

  it("returns 401 when the actor token is missing", async () => {
    const { enforceActorAccess, jwtVerify } = await loadModule("secret");
    const context = createContext();

    const response = await enforceActorAccess(context as never);

    expect(jwtVerify).not.toHaveBeenCalled();
    expect(context.json).toHaveBeenCalledWith(
      { error: "Unauthorized request." },
      401
    );
    expect(response?.status).toBe(401);
  });

  it("returns 400 when route params are incomplete", async () => {
    const { enforceActorAccess, jwtVerify } = await loadModule("secret");
    const context = createContext({
      headers: {
        "x-athena-actor-token": "token",
      },
      params: {
        userId: "user_123",
        storeId: "store_123",
      },
    });

    jwtVerify.mockResolvedValue({
      payload: {
        sub: "user_123",
        storeId: "store_123",
        organizationId: "org_123",
      },
    });

    const response = await enforceActorAccess(context as never);

    expect(context.json).toHaveBeenCalledWith(
      { error: "Invalid route context." },
      400
    );
    expect(response?.status).toBe(400);
  });

  it("returns 403 when claims do not match the route context", async () => {
    const { enforceActorAccess, jwtVerify } = await loadModule("secret");
    const context = createContext({
      headers: {
        "x-athena-actor-token": "token",
      },
      params: {
        userId: "user_123",
        storeId: "store_123",
        organizationId: "org_123",
      },
    });

    jwtVerify.mockResolvedValue({
      payload: {
        sub: "user_999",
        storeId: "store_123",
        organizationId: "org_123",
      },
    });

    const response = await enforceActorAccess(context as never);

    expect(context.json).toHaveBeenCalledWith({ error: "Forbidden." }, 403);
    expect(response?.status).toBe(403);
  });

  it("returns null when the token claims match the route context", async () => {
    const { enforceActorAccess, jwtVerify } = await loadModule("secret");
    const context = createContext({
      headers: {
        "x-athena-actor-token": "token",
      },
      params: {
        userId: "user_123",
        storeId: "store_123",
        organizationId: "org_123",
      },
    });

    jwtVerify.mockResolvedValue({
      payload: {
        sub: "user_123",
        storeId: "store_123",
        organizationId: "org_123",
      },
    });

    await expect(enforceActorAccess(context as never)).resolves.toBeNull();
    expect(context.json).not.toHaveBeenCalled();
  });
});

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

type CookieMap = Record<string, string | undefined>;

async function loadModule({
  cookies = {},
  claims = null,
}: {
  cookies?: CookieMap;
  claims?: {
    actorId: string;
    organizationId: string;
    storeId: string;
  } | null;
}) {
  vi.resetModules();

  const getCookie = vi.fn((_: unknown, name: string) => cookies[name]);
  const getActorClaims = vi.fn().mockResolvedValue(claims);

  vi.doMock("hono/cookie", () => ({
    getCookie,
  }));

  vi.doMock("./domains/storeFront/routes/actorAuth", () => ({
    getActorClaims,
  }));

  const module = await import("./utils");

  return {
    getActorClaims,
    getCookie,
    getStoreDataFromRequest: module.getStoreDataFromRequest,
    getStorefrontUserFromRequest: module.getStorefrontUserFromRequest,
  };
}

describe("http utils", () => {
  it("prefers store and organization cookies over actor claims", async () => {
    const { getActorClaims, getStoreDataFromRequest } = await loadModule({
      cookies: {
        organization_id: "org_cookie",
        store_id: "store_cookie",
      },
      claims: {
        actorId: "actor_1",
        organizationId: "org_claim",
        storeId: "store_claim",
      },
    });

    const result = await getStoreDataFromRequest({} as never);

    expect(result).toEqual({
      organizationId: "org_cookie",
      storeId: "store_cookie",
    });
    expect(getActorClaims).not.toHaveBeenCalled();
  });

  it("falls back to actor claims when store cookies are missing", async () => {
    const { getActorClaims, getStoreDataFromRequest } = await loadModule({
      cookies: {},
      claims: {
        actorId: "actor_1",
        organizationId: "org_claim",
        storeId: "store_claim",
      },
    });

    const result = await getStoreDataFromRequest({} as never);

    expect(result).toEqual({
      organizationId: "org_claim",
      storeId: "store_claim",
    });
    expect(getActorClaims).toHaveBeenCalledTimes(1);
  });

  it("prefers user cookie and falls back to actor id when user cookies are missing", async () => {
    const withUserCookie = await loadModule({
      cookies: {
        user_id: "user_cookie",
      },
      claims: {
        actorId: "actor_claim",
        organizationId: "org_claim",
        storeId: "store_claim",
      },
    });

    await expect(
      withUserCookie.getStorefrontUserFromRequest({} as never)
    ).resolves.toBe("user_cookie");
    expect(withUserCookie.getActorClaims).not.toHaveBeenCalled();

    const withClaimsFallback = await loadModule({
      cookies: {},
      claims: {
        actorId: "guest_claim",
        organizationId: "org_claim",
        storeId: "store_claim",
      },
    });

    await expect(
      withClaimsFallback.getStorefrontUserFromRequest({} as never)
    ).resolves.toBe("guest_claim");
    expect(withClaimsFallback.getActorClaims).toHaveBeenCalledTimes(1);
  });
});

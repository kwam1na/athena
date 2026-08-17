// @vitest-environment node
/// <reference types="vite/client" />

/**
 * Sign-in coverage for `storeFront/auth` and the route that now owns it.
 *
 * `storeFront/auth.verifyCode` and `sendVerificationCodeViaProvider` were
 * public Convex exports before the admission migration. They are now
 * `verifyCodeInternal` / `sendVerificationCodeViaProviderInternal`, reachable
 * only through `POST /auth/verify`, which merged the two former mutations into
 * one body-dispatched route (`code` vs `email`). The tests that covered the
 * public exports were deleted with them.
 *
 * Two layers are re-derived here.
 *
 * Route level (driving the EXPORTED `authRoutes` through the real admission
 * entry points): the `userId` and `storeId` the code is verified against come
 * from the ADMITTED claim, never from the request body — the specific thing the
 * migration changed. A forged body id must not be able to select a different
 * shopper, and both branches of the merged route must dispatch to the right
 * internal sibling.
 *
 * Mutation level (`convexTest` against the real database): a valid code signs
 * the shopper in and leaves a session row; a wrong or expired or already-used
 * code does not.
 */

import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  admitOperationWithCtx,
  admitReadOperationWithCtx,
} from "../platform/operationAdmission";
import { CUSTOMER_OWNERSHIP_DENIED } from "./customerOwnership";
import {
  GUEST_COOKIE_NAME,
  STOREFRONT_COOKIE_SECRET_ENV,
  signStorefrontCookieValue,
} from "../platform/storefrontCookieSignature";

import { authRoutes } from "../http/domains/core/routes/auth";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./storeFront/"),
    loader,
  ]),
);

const DENIED = new RegExp(
  CUSTOMER_OWNERSHIP_DENIED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);

/* -------------------------------------------------------------- route level */

const ALLOWED_ORIGIN = "https://shop.test";
const ORIGIN_ENV = "ATHENA_STOREFRONT_ALLOWED_ORIGINS";

const ADMIT_WRITE = getFunctionName(
  internal.platform.admissionEntrypoints.admitOperation,
);
const ADMIT_READ = getFunctionName(
  internal.platform.admissionEntrypoints.admitReadOperation,
);

type Rows = Record<string, Record<string, any>>;

function harness(rows: Rows = {}, results: Record<string, unknown> = {}) {
  const ctx = {
    auth: { getUserIdentity: async () => null },
    db: {
      get: async (table: string, id: string) => rows[table]?.[id] ?? null,
    },
  } as any;

  const calls: { name: string; args: any }[] = [];

  const dispatch = async (ref: any, args: any) => {
    const fnName = getFunctionName(ref);
    if (fnName === ADMIT_WRITE) return await admitOperationWithCtx(ctx, args);
    if (fnName === ADMIT_READ) return await admitReadOperationWithCtx(ctx, args);
    calls.push({ name: fnName, args });
    return results[fnName] ?? null;
  };

  return {
    calls,
    env: { runAction: dispatch, runMutation: dispatch, runQuery: dispatch },
    called: (fn: any) =>
      calls.find((call) => call.name === getFunctionName(fn)),
  };
}

const ROUTE_ROWS: Rows = {
  guest: {
    "guest-A": { _id: "guest-A", storeId: "store-1" },
  },
  storeFrontUser: {
    "user-A": { _id: "user-A", storeId: "store-1" },
    "user-B": { _id: "user-B", storeId: "store-1" },
  },
};

// The guest cookie is SIGNED: an unsigned `guest_id` is not a claim at all
// since the storefront cookie-signing change.
const COOKIE_SECRET = "test-storefront-cookie-secret";

const CLAIM_COOKIE = `guest_id=${signStorefrontCookieValue(
  GUEST_COOKIE_NAME,
  "guest-A",
  COOKIE_SECRET,
)}; store_id=store-1; organization_id=org-1`;

const ADMITTED_OWNER = { guestId: "guest-A", storeId: "store-1" };

const postVerify = (test: ReturnType<typeof harness>, body: unknown, cookie = CLAIM_COOKIE) =>
  authRoutes.fetch(
    new Request("https://api.test/verify", {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: ALLOWED_ORIGIN,
      },
      method: "POST",
    }),
    test.env as never,
  );

const withOrigin = async (run: () => Promise<void>) => {
  vi.stubEnv(ORIGIN_ENV, ALLOWED_ORIGIN);
  vi.stubEnv(STOREFRONT_COOKIE_SECRET_ENV, COOKIE_SECRET);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
  }
};

describe("POST /auth/verify", () => {
  it("verifies a code for the ADMITTED shopper and signs them in", async () => {
    await withOrigin(async () => {
      const test = harness(ROUTE_ROWS, {
        [getFunctionName(internal.storeFront.auth.verifyCodeInternal)]: {
          accessToken: "access",
          refreshToken: "refresh",
          success: true,
          user: { _id: "user-A", email: "shopper@test.com" },
        },
      });

      const response = await postVerify(test, {
        code: "123456",
        email: "shopper@test.com",
        // Forged: a bearer id for another shopper must not select that shopper.
        userId: "user-B",
        storeId: "store-2",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(
        expect.objectContaining({ success: true }),
      );
      // The session cookie is set to the verified account.
      expect(response.headers.get("set-cookie")).toContain("user_id=user-A");

      const call = test.called(internal.storeFront.auth.verifyCodeInternal);
      expect(call?.args.userId).toBe("guest-A");
      expect(call?.args.storeId).toBe("store-1");
      expect(call?.args.owner).toEqual(ADMITTED_OWNER);
      expect(call?.args.code).toBe("123456");
      expect(call?.args.email).toBe("shopper@test.com");
    });
  });

  it("does not sign anyone in when the code is rejected", async () => {
    await withOrigin(async () => {
      const test = harness(ROUTE_ROWS, {
        [getFunctionName(internal.storeFront.auth.verifyCodeInternal)]: {
          error: true,
          message: "Invalid verification code",
        },
      });

      const response = await postVerify(test, {
        code: "000000",
        email: "shopper@test.com",
      });

      expect(await response.json()).toEqual({
        error: true,
        message: "Invalid verification code",
      });
      // No `user` in the result means no session cookie is minted.
      expect(response.headers.get("set-cookie")).toBeNull();
    });
  });

  it("sends a verification code on the email branch, scoped to the admitted store", async () => {
    await withOrigin(async () => {
      const test = harness(ROUTE_ROWS, {
        [getFunctionName(
          internal.storeFront.auth.sendVerificationCodeViaProviderInternal,
        )]: { message: "Verification code sent", success: true },
      });

      const response = await postVerify(test, {
        email: "shopper@test.com",
        firstName: "Ada",
        lastName: "Shopper",
        // Forged: the store comes from the claim row, not the body.
        storeId: "store-2",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        message: "Verification code sent",
        success: true,
      });

      const call = test.called(
        internal.storeFront.auth.sendVerificationCodeViaProviderInternal,
      );
      expect(call?.args.storeId).toBe("store-1");
      expect(call?.args.owner).toEqual(ADMITTED_OWNER);
      expect(call?.args.email).toBe("shopper@test.com");
      // The code branch is not taken.
      expect(
        test.called(internal.storeFront.auth.verifyCodeInternal),
      ).toBeUndefined();
    });
  });

  it("denies a cookieless verification before either sibling is called", async () => {
    await withOrigin(async () => {
      const test = harness(ROUTE_ROWS);

      const response = await authRoutes.fetch(
        new Request("https://api.test/verify", {
          body: JSON.stringify({ code: "123456", email: "shopper@test.com" }),
          headers: {
            "Content-Type": "application/json",
            Origin: ALLOWED_ORIGIN,
          },
          method: "POST",
        }),
        test.env as never,
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(test.calls).toEqual([]);
    });
  });

  it("denies a foreign origin before admission runs", async () => {
    await withOrigin(async () => {
      const evil = harness(ROUTE_ROWS);
      const denied = await authRoutes.fetch(
        new Request("https://api.test/verify", {
          body: JSON.stringify({ code: "123456", email: "shopper@test.com" }),
          headers: {
            "Content-Type": "application/json",
            Cookie: CLAIM_COOKIE,
            Origin: "https://evil.test",
          },
          method: "POST",
        }),
        evil.env as never,
      );

      expect(denied.status).toBe(403);
      expect(evil.calls).toEqual([]);
    });
  });
});

/* ----------------------------------------------------------- mutation level */

async function seed() {
  const t = convexTest(schema, modules);

  const fixture = await t.run(async (ctx) => {
    const athenaUserId = await ctx.db.insert("athenaUser", {
      email: "operator@test",
      normalizedEmail: "operator@test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: athenaUserId,
      name: "org",
      slug: "org",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: athenaUserId,
      currency: "GHS",
      name: "store",
      organizationId,
      slug: "store",
    });

    const alice = await ctx.db.insert("guest", {
      marker: "alice",
      organizationId,
      storeId,
    });
    const bob = await ctx.db.insert("guest", {
      marker: "bob",
      organizationId,
      storeId,
    });

    return { alice, bob, organizationId, storeId };
  });

  return { t, ...fixture };
}

async function issueCode(
  f: Awaited<ReturnType<typeof seed>>,
  overrides: { code?: string; expiration?: number; isUsed?: boolean } = {},
) {
  return await f.t.run(async (ctx) =>
    ctx.db.insert("storeFrontVerificationCode", {
      code: overrides.code ?? "123456",
      email: "shopper@test.com",
      expiration: overrides.expiration ?? Date.now() + 10 * 60 * 1000,
      firstName: "Ada",
      isUsed: overrides.isUsed ?? false,
      lastName: "Shopper",
      storeId: f.storeId,
    }),
  );
}

const verify = (
  f: Awaited<ReturnType<typeof seed>>,
  args: { code: string; userId: Id<"guest">; owner: any },
) =>
  f.t.mutation(internal.storeFront.auth.verifyCodeInternal, {
    code: args.code,
    email: "shopper@test.com",
    organizationId: f.organizationId,
    owner: args.owner,
    storeId: f.storeId,
    userId: args.userId,
  });

async function otherStore(f: Awaited<ReturnType<typeof seed>>) {
  return await f.t.run(async (ctx) => {
    const athenaUserId = await ctx.db.insert("athenaUser", {
      email: "other@test",
      normalizedEmail: "other@test",
    });
    return await ctx.db.insert("store", {
      createdByUserId: athenaUserId,
      currency: "GHS",
      name: "other",
      organizationId: f.organizationId,
      slug: "other",
    });
  });
}

describe("auth.verifyCodeInternal", () => {
  it("signs the admitted shopper in on a valid code and records a session", async () => {
    const f = await seed();
    const codeId = await issueCode(f);

    const result: any = await verify(f, {
      code: "123456",
      owner: { guestId: f.alice, storeId: f.storeId },
      userId: f.alice,
    });

    expect(result.success).toBe(true);
    expect(result.user?.email).toBe("shopper@test.com");
    expect(result.accessToken).toEqual(expect.any(String));

    const sessions = await f.t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db.query("storeFrontSession").collect(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe(result.user._id);

    // The code is single-use once redeemed.
    const code = await f.t.run((ctx) =>
      ctx.db.get("storeFrontVerificationCode", codeId),
    );
    expect(code?.isUsed).toBe(true);
  });

  it("refuses a wrong code and mints no session", async () => {
    const f = await seed();
    await issueCode(f);

    const result: any = await verify(f, {
      code: "000000",
      owner: { guestId: f.alice, storeId: f.storeId },
      userId: f.alice,
    });

    expect(result).toEqual({
      error: true,
      message: "Invalid verification code",
    });
    expect(
      await f.t.run(async (ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        (await ctx.db.query("storeFrontSession").collect()).length,
      ),
    ).toBe(0);
  });

  it("refuses an expired and an already-used code", async () => {
    const expired = await seed();
    await issueCode(expired, { expiration: Date.now() - 1_000 });
    expect(
      await verify(expired, {
        code: "123456",
        owner: { guestId: expired.alice, storeId: expired.storeId },
        userId: expired.alice,
      }),
    ).toEqual({ error: true, message: "This verification code has expired" });

    const used = await seed();
    await issueCode(used, { isUsed: true });
    expect(
      await verify(used, {
        code: "123456",
        owner: { guestId: used.alice, storeId: used.storeId },
        userId: used.alice,
      }),
    ).toEqual({
      error: true,
      message: "This verification code has already been used",
    });

    for (const f of [expired, used]) {
      expect(
        await f.t.run(async (ctx) =>
          // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
          (await ctx.db.query("storeFrontSession").collect()).length,
        ),
      ).toBe(0);
    }
  });

  it("refuses a userId that is not the admitted shopper, even with a valid code", async () => {
    const f = await seed();
    await issueCode(f);

    await expect(
      verify(f, {
        code: "123456",
        owner: { guestId: f.alice, storeId: f.storeId },
        // Bob's id with Alice's claim: the code may only ever be redeemed for
        // the shopper the rail admitted.
        userId: f.bob,
      }),
    ).rejects.toThrow(DENIED);

    expect(
      await f.t.run(async (ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        (await ctx.db.query("storeFrontSession").collect()).length,
      ),
    ).toBe(0);
  });

  it("refuses a store the admitted claim was not clamped to", async () => {
    const f = await seed();
    await issueCode(f);

    const otherStoreId = await otherStore(f);

    await expect(
      f.t.mutation(internal.storeFront.auth.verifyCodeInternal, {
        code: "123456",
        email: "shopper@test.com",
        organizationId: f.organizationId,
        owner: { guestId: f.alice, storeId: otherStoreId },
        storeId: f.storeId,
        userId: f.alice,
      }),
    ).rejects.toThrow(DENIED);

    expect(
      await f.t.run(async (ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        (await ctx.db.query("storeFrontSession").collect()).length,
      ),
    ).toBe(0);
  });
});

describe("auth.sendVerificationCodeViaProviderInternal", () => {
  it("refuses to send a code for a store the admitted claim was not clamped to", async () => {
    const f = await seed();
    const otherStoreId = await otherStore(f);

    await expect(
      f.t.action(
        internal.storeFront.auth.sendVerificationCodeViaProviderInternal,
        {
          email: "shopper@test.com",
          owner: { guestId: f.alice, storeId: otherStoreId },
          storeId: f.storeId,
        },
      ),
    ).rejects.toThrow(DENIED);

    // The denial happens before a code is ever minted, so nothing is issuable.
    expect(
      await f.t.run(async (ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        (await ctx.db.query("storeFrontVerificationCode").collect()).length,
      ),
    ).toBe(0);
  });
});

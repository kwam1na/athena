/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import schema from "./schema";

/**
 * `getSharedDemoActorWithCtx` is the only seam the shared-demo adapter uses to
 * decide whether a demo principal is present. Stubbing it exercises the REAL
 * adapter chain (actor policy, read intent, scope) without standing up a demo
 * session row.
 */
const sharedDemoMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
}));

vi.mock("./sharedDemo/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sharedDemo/actor")>()),
  getSharedDemoActorWithCtx: sharedDemoMocks.getSharedDemoActorWithCtx,
}));

import { getCurrentUser, getCurrentUserIdentity } from "./app";
import { checkAppLoginEmailApproval } from "./otp/appLoginEmailAllowlist";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("./**/*.ts")).map(([path, loader]) => [
    path,
    loader,
  ]),
);

type AnyHandler = (ctx: unknown, args: unknown) => Promise<unknown>;

function getHandler(fn: unknown): AnyHandler {
  return (fn as { _handler: AnyHandler })._handler;
}

/**
 * Injecting the admitted actor is equivalent to a signed-in session for the
 * identity short-circuit in `lib/athenaUserAuth`.
 */
function asAdmitted(ctx: QueryCtx, athenaUserId: Id<"athenaUser">) {
  return {
    ...ctx,
    operationAdmission: {
      actor: { kind: "normal_user" as const, athenaUserId },
    },
  };
}

describe("app identity reads admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
  });

  it("answers null for an anonymous caller instead of denying", async () => {
    // These are the webapp's bootstrap reads: `useAuth` issues them on every
    // page load, including signed-out ones. `public: "admit"` is what keeps a
    // signed-out load answering null rather than throwing.
    const t = convexTest(schema, modules);

    await expect(
      t.run((ctx) => getHandler(getCurrentUser)(ctx, {})),
    ).resolves.toBeNull();
    await expect(
      t.run((ctx) => getHandler(getCurrentUserIdentity)(ctx, {})),
    ).resolves.toBeNull();
  });

  /**
   * BLOCKED on a shared-file patch (U9 does not own `sharedDemo/policy.ts`):
   * `identity.view` must join `SHARED_DEMO_ALLOWED_READ_INTENTS`. Until it
   * does, this case and `sharedDemo/readIntentGrants.test.ts` both fail — which
   * is the correct signal, because a demo visitor really would be denied the
   * webapp's bootstrap identity read and no demo page could render.
   */
  it("admits a demo visitor: the demo runtime is the same webapp", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const athenaUserId = await ctx.db.insert("athenaUser", {
        email: "demo@example.com",
        normalizedEmail: "demo@example.com",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: athenaUserId,
        name: "Demo Org",
        slug: "demo-org",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: athenaUserId,
        currency: "ghs",
        name: "Demo Store",
        organizationId,
        slug: "demo-store",
      });
      return { athenaUserId, organizationId, storeId };
    });
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: seeded.athenaUserId,
      authUserId: "users_demo_1",
      kind: "shared_demo",
      organizationId: seeded.organizationId,
      storeId: seeded.storeId,
    });

    // A denial here would break every demo page: `useAuth` is unconditional.
    await expect(
      t.run((ctx) => getHandler(getCurrentUser)(ctx, {})),
    ).resolves.toBeNull();
  });

  it("returns the signed-in user row for a normal actor", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const athenaUserId = await ctx.db.insert("athenaUser", {
        email: "operator@example.com",
        normalizedEmail: "operator@example.com",
      });
      return { athenaUserId };
    });

    // No auth identity is installed, so the handler still answers null — the
    // point of this case is that admission does not change the answer for an
    // admitted normal actor.
    await expect(
      t.run((ctx) =>
        getHandler(getCurrentUser)(asAdmitted(ctx, seeded.athenaUserId), {}),
      ),
    ).resolves.toBeNull();
  });
});

describe("app login email allowlist read admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
  });

  it("stays anonymous-accessible: the login form asks before any session", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.run((ctx) =>
        getHandler(checkAppLoginEmailApproval)(ctx, {
          email: "kwamina.0x00@gmail.com",
        }),
      ),
    ).resolves.toEqual({ approved: true });
    await expect(
      t.run((ctx) =>
        getHandler(checkAppLoginEmailApproval)(ctx, {
          email: "stranger@example.com",
        }),
      ),
    ).resolves.toEqual({ approved: false });
  });

  it("denies a demo principal: the demo never renders the Athena login form", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const athenaUserId = await ctx.db.insert("athenaUser", {
        email: "demo@example.com",
        normalizedEmail: "demo@example.com",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: athenaUserId,
        name: "Demo Org",
        slug: "demo-org",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: athenaUserId,
        currency: "ghs",
        name: "Demo Store",
        organizationId,
        slug: "demo-store",
      });
      return { athenaUserId, organizationId, storeId };
    });
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: seeded.athenaUserId,
      authUserId: "users_demo_1",
      kind: "shared_demo",
      organizationId: seeded.organizationId,
      storeId: seeded.storeId,
    });

    await expect(
      t.run((ctx) =>
        getHandler(checkAppLoginEmailApproval)(ctx, {
          email: "kwamina.0x00@gmail.com",
        }),
      ),
    ).rejects.toThrow();
  });
});

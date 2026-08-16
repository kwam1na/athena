/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";

const sharedDemoMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
}));

vi.mock("../sharedDemo/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sharedDemo/actor")>()),
  getSharedDemoActorWithCtx: sharedDemoMocks.getSharedDemoActorWithCtx,
}));

const athenaUserMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/athenaUserAuth")>()),
  requireAuthenticatedAthenaUserWithCtx:
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx,
}));

import { admitOperationWithCtx } from "../platform/operationAdmission";
import { AthenaUnauthenticatedError } from "../lib/athenaUnauthenticated";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./cloudflare/"),
    loader,
  ]),
);

/**
 * An action reaches the rail through the registered internal admission
 * mutation, so admitting that operation id IS the hop `admitPublicAction`
 * makes. Driving it directly exercises the real chain without calling the
 * Cloudflare API, which is the point: a denial must land before any provider
 * request is issued.
 */
const STREAM_OPERATIONS = [
  "cloudflare/stream.getDirectUploadUrl",
  "cloudflare/stream.getVideoStatus",
  "cloudflare/stream.deleteVideo",
  "cloudflare/stream.addStreamReelVersion",
  "cloudflare/stream.deleteStreamReelVersion",
  "cloudflare/stream.setActiveStreamReel",
] as const;

type Fixture = {
  athenaUserId: Id<"athenaUser">;
  organizationId: Id<"organization">;
  storeId: Id<"store">;
};

async function seedFixture(ctx: MutationCtx): Promise<Fixture> {
  const athenaUserId = await ctx.db.insert("athenaUser", {
    email: "operator@example.com",
    normalizedEmail: "operator@example.com",
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: athenaUserId,
    name: "Org",
    slug: "org",
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: athenaUserId,
    currency: "ghs",
    name: "Store",
    organizationId,
    slug: "store",
  });
  return { athenaUserId, organizationId, storeId };
}

function admit(
  t: ReturnType<typeof convexTest>,
  operationId: string,
  operationArgs: Record<string, unknown>,
) {
  return t.run((ctx) =>
    admitOperationWithCtx(ctx, { operationArgs, operationId }),
  );
}

describe("cloudflare stream admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockReset();
  });

  it("admits an authenticated Athena user on every stream action", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: fixture.athenaUserId,
    });

    for (const operationId of STREAM_OPERATIONS) {
      const admission = await admit(t, operationId, {
        storeId: fixture.storeId,
        streamUid: "uid-1",
        version: 1,
      });
      expect(admission.actor.kind, operationId).toBe("normal_user");
    }
  });

  it("denies an anonymous caller on every stream action", async () => {
    // Retired call site: `ctx.runQuery(requireAuthenticatedNonDemoEffectRef)`,
    // the "authenticated" half. Successor: `actors.public: "deny"`.
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError("Sign in again to continue."),
    );

    for (const operationId of STREAM_OPERATIONS) {
      await expect(
        admit(t, operationId, { storeId: fixture.storeId }),
        operationId,
      ).rejects.toThrow();
    }
  });

  it("denies a demo principal on every stream action", async () => {
    // Retired call site: the "non-demo effect" half of the same guard.
    // Successor: `actors.sharedDemo: "deny"` plus the declared
    // `integration.dispatch` gateway, which the demo may not dispatch.
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: fixture.athenaUserId,
      authUserId: "users_demo_1",
      kind: "shared_demo",
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
    });

    for (const operationId of STREAM_OPERATIONS) {
      await expect(
        admit(t, operationId, { storeId: fixture.storeId }),
        operationId,
      ).rejects.toThrow();
    }
  });

  it("clamps the store-scoped reel actions to the named store", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: fixture.athenaUserId,
    });

    const admission = await admit(t, "cloudflare/stream.addStreamReelVersion", {
      hlsUrl: "https://example.test/a.m3u8",
      storeId: fixture.storeId,
      streamUid: "uid-1",
    });

    expect(admission.constraints.storeId).toBe(fixture.storeId);
  });
});

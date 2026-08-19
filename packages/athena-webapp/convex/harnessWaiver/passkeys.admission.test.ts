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

import { AthenaUnauthenticatedError } from "../lib/athenaUnauthenticated";
import { admitOperationWithCtx } from "../platform/operationAdmission";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./harnessWaiver/"),
    loader,
  ]),
);

const CEREMONY_OPERATIONS = [
  "harnessWaiver/passkeys.beginRegistration",
  "harnessWaiver/passkeys.completeRegistration",
  "harnessWaiver/passkeys.getApprovalOptions",
  "harnessWaiver/passkeys.completeApproval",
] as const;

const AUTHORIZE = "harnessWaiver/registrationAuthorization.authorizeRegistration";

async function seedFixture(ctx: MutationCtx): Promise<Id<"athenaUser">> {
  return ctx.db.insert("athenaUser", {
    email: "reviewer@example.com",
    normalizedEmail: "reviewer@example.com",
  });
}

function admit(
  t: ReturnType<typeof convexTest>,
  operationId: string,
  operationArgs: Record<string, unknown> = {},
) {
  return t.run((ctx) =>
    admitOperationWithCtx(ctx, { operationArgs, operationId }),
  );
}

describe("harness waiver admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockReset();
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError("Sign in again to continue."),
    );
  });

  it("keeps the four ceremony actions anonymous-accessible", async () => {
    // The harness client and the reviewer's approval page hold tokens, not an
    // Athena session. Denying `public` here would make waiver enrollment and
    // approval unreachable.
    const t = convexTest(schema, modules);

    for (const operationId of CEREMONY_OPERATIONS) {
      const admission = await admit(t, operationId, { token: "opaque" });
      expect(admission.actor.kind, operationId).toBe("public");
    }
  });

  it("denies a demo principal on every ceremony action", async () => {
    const t = convexTest(schema, modules);
    const athenaUserId = await t.run(seedFixture);
    const seeded = await t.run(async (ctx) => {
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
      return { organizationId, storeId };
    });
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId,
      authUserId: "users_demo_1",
      kind: "shared_demo",
      organizationId: seeded.organizationId,
      storeId: seeded.storeId,
    });

    for (const operationId of CEREMONY_OPERATIONS) {
      await expect(
        admit(t, operationId, { token: "opaque" }),
        operationId,
      ).rejects.toThrow();
    }
  });

  it("requires a signed-in reviewer to authorize an enrollment", async () => {
    const t = convexTest(schema, modules);
    await t.run(seedFixture);

    await expect(
      admit(t, AUTHORIZE, { bootstrapSecret: "s", tokenHash: "a".repeat(64) }),
    ).rejects.toThrow();
  });

  it("admits a signed-in reviewer to authorize an enrollment", async () => {
    const t = convexTest(schema, modules);
    const athenaUserId = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: athenaUserId,
    });

    const admission = await admit(t, AUTHORIZE, {
      bootstrapSecret: "s",
      tokenHash: "a".repeat(64),
    });
    expect(admission.actor.kind).toBe("normal_user");
  });
});

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
      : path.replace(/^\.\//, "./remoteAssist/"),
    loader,
  ]),
);

const SUPPORT = "remoteAssist/transport.requestSupportCredential";
const RUNTIME = "remoteAssist/transport.requestRuntimeCredential";

type Fixture = {
  athenaUserId: Id<"athenaUser">;
  organizationId: Id<"organization">;
  storeId: Id<"store">;
};

async function seedFixture(ctx: MutationCtx): Promise<Fixture> {
  const athenaUserId = await ctx.db.insert("athenaUser", {
    email: "support@example.com",
    normalizedEmail: "support@example.com",
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

describe("remote assist transport admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockReset();
  });

  it("admits a signed-in support operator", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: fixture.athenaUserId,
    });

    const admission = await admit(t, SUPPORT, { sessionId: "session-1" });
    expect(admission.actor.kind).toBe("normal_user");
  });

  it("denies an anonymous support credential request", async () => {
    // Support joins as a signed-in full admin; the org-membership proof still
    // runs inside `prepareSupportCredential`.
    const t = convexTest(schema, modules);
    await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError("Sign in again to continue."),
    );

    await expect(admit(t, SUPPORT, { sessionId: "session-1" })).rejects.toThrow();
  });

  it("admits an anonymous POS runtime and clamps it to the named store", async () => {
    // The runtime authenticates with a terminal sync-secret proof and carries
    // no Athena session, so this operation admits `public` on purpose; the
    // proof is re-checked against the terminal row in the internal mutation.
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError("Sign in again to continue."),
    );

    const admission = await admit(t, RUNTIME, {
      sessionId: "session-1",
      storeId: fixture.storeId,
      syncSecretHash: "hash",
      terminalId: "terminal-1",
    });

    expect(admission.actor.kind).toBe("public");
    expect(admission.constraints.storeId).toBe(fixture.storeId);
  });

  it("denies a demo principal on both credential requests", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: fixture.athenaUserId,
      authUserId: "users_demo_1",
      kind: "shared_demo",
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
    });

    await expect(admit(t, SUPPORT, { sessionId: "session-1" })).rejects.toThrow();
    await expect(
      admit(t, RUNTIME, {
        sessionId: "session-1",
        storeId: fixture.storeId,
        syncSecretHash: "hash",
        terminalId: "terminal-1",
      }),
    ).rejects.toThrow();
  });
});

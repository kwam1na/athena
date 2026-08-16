/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import schema from "../schema";

/**
 * Both seams are stubbed together: the adapter reads
 * `getSharedDemoActorWithCtx`, and the handler reads
 * `requireSharedDemoActorWithCtx`. The real module resolves the second from its
 * own module-local binding, so mocking only the first would leave the handler
 * seeing no demo visitor while the adapter saw one.
 */
const sharedDemoMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  requireSharedDemoActorWithCtx: vi.fn(),
}));

vi.mock("./actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actor")>()),
  getSharedDemoActorWithCtx: sharedDemoMocks.getSharedDemoActorWithCtx,
  requireSharedDemoActorWithCtx: sharedDemoMocks.requireSharedDemoActorWithCtx,
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
import { getContext, getRegisterBootstrap } from "./public";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./sharedDemo/"),
    loader,
  ]),
);

type AnyHandler = (ctx: unknown, args: unknown) => Promise<unknown>;

function getHandler(fn: unknown): AnyHandler {
  return (fn as { _handler: AnyHandler })._handler;
}

function asAdmitted(ctx: QueryCtx, athenaUserId: Id<"athenaUser">) {
  return {
    ...ctx,
    operationAdmission: {
      actor: { kind: "normal_user" as const, athenaUserId },
    },
  };
}

async function seedFixture(ctx: MutationCtx) {
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

describe("shared demo context reads admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    sharedDemoMocks.requireSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.requireSharedDemoActorWithCtx.mockRejectedValue(
      new Error("The demo session has expired. Open the demo again."),
    );
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockReset();
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError("Sign in again to continue."),
    );
  });

  it("answers null for an anonymous caller rather than denying", async () => {
    // This is how every ordinary page load asks "am I in the demo?". A denial
    // here would throw on every signed-out load.
    const t = convexTest(schema, modules);

    await expect(
      t.run((ctx) => getHandler(getContext)(ctx, {})),
    ).resolves.toBeNull();
    await expect(
      t.run((ctx) => getHandler(getRegisterBootstrap)(ctx, {})),
    ).resolves.toBeNull();
  });

  it("answers null for a signed-in normal user rather than denying", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: fixture.athenaUserId,
    });

    await expect(
      t.run((ctx) =>
        getHandler(getContext)(asAdmitted(ctx, fixture.athenaUserId), {}),
      ),
    ).resolves.toBeNull();
  });

  it("admits a demo visitor and answers from the demo store", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    await t.run((ctx) =>
      ctx.db.insert("sharedDemoRestoreState", {
        baselineVersion: 1,
        completedAt: 1,
        epoch: 2,
        status: "ready",
        storeId: fixture.storeId,
      }),
    );
    const demoActor = {
      athenaUserId: fixture.athenaUserId,
      authUserId: "users_demo_1",
      kind: "shared_demo" as const,
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
    };
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(demoActor);
    sharedDemoMocks.requireSharedDemoActorWithCtx.mockResolvedValue(demoActor);

    const context = (await t.run((ctx) =>
      getHandler(getContext)(ctx, {}),
    )) as { kind: string; storeId: Id<"store"> } | null;

    expect(context?.kind).toBe("shared_demo");
    expect(context?.storeId).toBe(fixture.storeId);
  });
});

describe("shared demo ticket admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    sharedDemoMocks.requireSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.requireSharedDemoActorWithCtx.mockRejectedValue(
      new Error("The demo session has expired. Open the demo again."),
    );
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockReset();
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError("Sign in again to continue."),
    );
  });

  it("admits an anonymous visitor: this is the demo's front door", async () => {
    const t = convexTest(schema, modules);

    const admission = await t.run((ctx) =>
      admitOperationWithCtx(ctx, {
        operationArgs: {},
        operationId: "sharedDemo/admission.issueSharedDemoTicket",
      }),
    );

    expect(admission.actor.kind).toBe("public");
  });

  it("admits a signed-in Athena user opening the demo", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: fixture.athenaUserId,
    });

    const admission = await t.run((ctx) =>
      admitOperationWithCtx(ctx, {
        operationArgs: {},
        operationId: "sharedDemo/admission.issueSharedDemoTicket",
      }),
    );

    expect(admission.actor.kind).toBe("normal_user");
  });
});

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

import { recordDocsWorkspaceVisit } from "./athenaWebappEvents";
import { recordSharedDemoActivity } from "./sharedDemoEvents";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./contextTracking/"),
    loader,
  ]),
);

type AnyHandler = (ctx: unknown, args: unknown) => Promise<unknown>;

function getHandler(fn: unknown): AnyHandler {
  return (fn as { _handler: AnyHandler })._handler;
}

function asAdmitted(ctx: MutationCtx, athenaUserId: Id<"athenaUser">) {
  return {
    ...ctx,
    operationAdmission: {
      actor: { kind: "normal_user" as const, athenaUserId },
    },
  };
}

type Fixture = {
  athenaUserId: Id<"athenaUser">;
  organizationId: Id<"organization">;
  otherStoreId: Id<"store">;
  storeId: Id<"store">;
};

async function seedFixture(ctx: MutationCtx): Promise<Fixture> {
  const athenaUserId = await ctx.db.insert("athenaUser", {
    email: "demo-owner@example.com",
    normalizedEmail: "demo-owner@example.com",
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
  const otherStoreId = await ctx.db.insert("store", {
    createdByUserId: athenaUserId,
    currency: "ghs",
    name: "Other Store",
    organizationId,
    slug: "other-store",
  });
  return { athenaUserId, organizationId, otherStoreId, storeId };
}

const SESSION_ID = "9f3c1b7a-1111-2222-3333-444455556666";

function activityArgs(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "shared_demo.surface_viewed" as const,
    idempotencyKey: `shared-demo:${SESSION_ID}:surface_viewed:pos.checkout`,
    occurredAt: Date.now(),
    payload: {
      routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/pos",
      surfaceKey: "pos.checkout",
    },
    schemaVersion: 1 as const,
    sessionId: SESSION_ID,
    viewportBucket: "lg" as const,
    ...overrides,
  };
}

function docsVisitArgs() {
  return {
    eventId: "athena_webapp.workspace_viewed" as const,
    idempotencyKey: `docs-workspace:${SESSION_ID}:anonymous`,
    occurredAt: Date.now(),
    payload: { route: "/docs" as const, workspace: "docs" as const },
    schemaVersion: 1 as const,
    sessionId: SESSION_ID,
    viewportBucket: "lg" as const,
  };
}

async function countEvents(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => (await ctx.db.query("contextEvent").take(50)).length);
}

describe("recordSharedDemoActivity admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
  });

  it("admits a demo visitor and attributes the event to the ADMITTED actor", async () => {
    // Retired call site: `getSharedDemoActorWithCtx(ctx)` inside the handler.
    // Successor: the shared-demo adapter, which is now the only source of the
    // store, organization, and per-visitor auth user this event carries.
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    const authUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Athena demo owner" }),
    );
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: fixture.athenaUserId,
      authUserId,
      kind: "shared_demo",
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
    });

    const result = (await t.run((ctx) =>
      getHandler(recordSharedDemoActivity)(ctx, activityArgs()),
    )) as { kind: string };

    expect(result.kind).toBe("recorded");
    // The admitted-action capture writes its own row in the same transaction,
    // so pick the activity event by its id rather than by position.
    const event = await t.run(async (ctx) =>
      (await ctx.db.query("contextEvent").take(10)).find(
        (row) => row.eventId === "shared_demo.surface_viewed",
      ),
    );
    expect(event?.storeId).toBe(fixture.storeId);
    expect(event?.actorRef).toEqual({ kind: "guest", id: authUserId });
    // The browser never supplied the store: it arrived as the admitted actor,
    // so a demo visitor cannot attribute activity to another store.
    expect(event?.storeId).not.toBe(fixture.otherStoreId);
  });

  it("denies an anonymous caller before anything is appended", async () => {
    const t = convexTest(schema, modules);
    await t.run(seedFixture);

    await expect(
      t.run((ctx) => getHandler(recordSharedDemoActivity)(ctx, activityArgs())),
    ).rejects.toThrow();
    expect(await countEvents(t)).toBe(0);
  });

  it("denies a signed-in normal user: this surface is demo-only", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await expect(
      t.run((ctx) =>
        getHandler(recordSharedDemoActivity)(
          asAdmitted(ctx, fixture.athenaUserId),
          activityArgs(),
        ),
      ),
    ).rejects.toThrow();
    expect(await countEvents(t)).toBe(0);
  });

  it("still rejects a malformed envelope after admission", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    const authUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Athena demo owner" }),
    );
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: fixture.athenaUserId,
      authUserId,
      kind: "shared_demo",
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
    });

    const result = (await t.run((ctx) =>
      getHandler(recordSharedDemoActivity)(
        ctx,
        activityArgs({ sessionId: "not a session", idempotencyKey: "nope" }),
      ),
    )) as { kind: string; message?: string };

    expect(result).toEqual({
      kind: "rejected",
      message: "Invalid demo activity envelope.",
    });
    // Only the admitted-action capture row exists; nothing from this envelope.
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("contextEvent").take(10)).filter(
          (row) => row.eventId === "shared_demo.surface_viewed",
        ).length,
      ),
    ).toBe(0);
  });
});

describe("recordDocsWorkspaceVisit admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
  });

  it("keeps recording anonymous docs visits", async () => {
    const t = convexTest(schema, modules);

    const result = (await t.run((ctx) =>
      getHandler(recordDocsWorkspaceVisit)(ctx, docsVisitArgs()),
    )) as { kind: string };

    expect(result.kind).toBe("recorded");
  });

  it("denies a demo principal: workspace telemetry is not demo-granted", async () => {
    // Narrower than before on purpose. `workspace.telemetry.write` is not in
    // `SHARED_DEMO_ALLOWED_CAPABILITIES`, and the demo reports its own activity
    // through `recordSharedDemoActivity` instead.
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: fixture.athenaUserId,
      authUserId: "users_demo_1",
      kind: "shared_demo",
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
    });

    await expect(
      t.run((ctx) => getHandler(recordDocsWorkspaceVisit)(ctx, docsVisitArgs())),
    ).rejects.toThrow();
    expect(await countEvents(t)).toBe(0);
  });
});

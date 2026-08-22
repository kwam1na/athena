/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";

const sharedDemoMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
}));

/**
 * `requireStoreFullAdminAccess` resolves identity through `getAuthUserId`, not
 * through the admitted actor, so it is stubbed here: these cases are about what
 * ADMISSION decides, and the stub makes it observable that the handler-local
 * guard still runs on every admitted call.
 */
const accessMocks = vi.hoisted(() => ({
  requireStoreFullAdminAccess: vi.fn(),
}));

vi.mock("../stockOps/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stockOps/access")>()),
  requireStoreFullAdminAccess: accessMocks.requireStoreFullAdminAccess,
}));

vi.mock("../sharedDemo/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sharedDemo/actor")>()),
  getSharedDemoActorWithCtx: sharedDemoMocks.getSharedDemoActorWithCtx,
}));

import { dismissArtifact, latestArtifact, latestArtifactBySubject, latestRunDebug } from "./runs";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./intelligence/"),
    loader,
  ]),
);

/**
 * The stubbed access guard has to answer with a REAL athenaUser id: the
 * dismissal writes an operational event that references it.
 */
let adminAId: Id<"athenaUser">;

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
  adminA: Id<"athenaUser">;
  adminB: Id<"athenaUser">;
  artifactA: Id<"intelligenceArtifact">;
  organizationA: Id<"organization">;
  storeA: Id<"store">;
};

async function seedFixture(ctx: MutationCtx): Promise<Fixture> {
  const adminA = await ctx.db.insert("athenaUser", {
    email: "admin-a@example.com",
    normalizedEmail: "admin-a@example.com",
  });
  const adminB = await ctx.db.insert("athenaUser", {
    email: "admin-b@example.com",
    normalizedEmail: "admin-b@example.com",
  });
  const organizationA = await ctx.db.insert("organization", {
    createdByUserId: adminA,
    name: "Org A",
    slug: "org-a",
  });
  const organizationB = await ctx.db.insert("organization", {
    createdByUserId: adminB,
    name: "Org B",
    slug: "org-b",
  });
  const storeA = await ctx.db.insert("store", {
    createdByUserId: adminA,
    currency: "ghs",
    name: "Org A Store",
    organizationId: organizationA,
    slug: "org-a-store",
  });
  await ctx.db.insert("organizationMember", {
    organizationId: organizationA,
    role: "full_admin",
    userId: adminA,
  });
  await ctx.db.insert("organizationMember", {
    organizationId: organizationB,
    role: "full_admin",
    userId: adminB,
  });

  const now = Date.now();
  const runId = await ctx.db.insert("intelligenceRun", {
    attemptCount: 1,
    capability: "storeInsights",
    createdAt: now,
    idempotencyKey: "storeInsights:1",
    principalKind: "athenaUser",
    providerKey: "fake",
    sourceRefs: [],
    status: "completed",
    storeId: storeA,
    trigger: "operator",
    updatedAt: now,
    visibilityMode: "store_admin",
  });
  const contextSnapshotId = await ctx.db.insert("intelligenceContextSnapshot", {
    capability: "storeInsights",
    createdAt: now,
    payloadSummary: {},
    principalKind: "athenaUser",
    runId,
    snapshotHash: "hash-1",
    sourceRefs: [],
    storeId: storeA,
    visibilityMode: "store_admin",
  });
  const artifactA = await ctx.db.insert("intelligenceArtifact", {
    capability: "storeInsights",
    contextSnapshotId,
    createdAt: now,
    evidenceRefs: [],
    kind: "store_insights",
    payload: {},
    runId,
    snapshotHash: "hash-1",
    sourceRefs: [],
    status: "ready",
    storeId: storeA,
    updatedAt: now,
    visibilityMode: "store_admin",
  });

  adminAId = adminA;
  return { adminA, adminB, artifactA, organizationA, storeA };
}

describe("intelligence admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    accessMocks.requireStoreFullAdminAccess.mockReset();
    accessMocks.requireStoreFullAdminAccess.mockImplementation(
      async (_ctx: unknown, _storeId: unknown) => ({
        athenaUser: { _id: adminAId },
      }),
    );
  });

  it("admits a full admin and returns the latest artifact unchanged", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const result = (await t.run((ctx) =>
      getHandler(latestArtifact)(asAdmitted(ctx, fixture.adminA), {
        capability: "storeInsights",
        kind: "store_insights",
        storeId: fixture.storeA,
      }),
    )) as { _id: Id<"intelligenceArtifact"> } | null;

    expect(result?._id).toBe(fixture.artifactA);
  });

  it("denies an unauthenticated reader", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await expect(
      t.run((ctx) =>
        getHandler(latestArtifact)(ctx, {
          capability: "storeInsights",
          kind: "store_insights",
          storeId: fixture.storeA,
        }),
      ),
    ).rejects.toThrow("Sign in again to continue.");
    expect(accessMocks.requireStoreFullAdminAccess).not.toHaveBeenCalled();
  });

  it("denies a demo principal: intelligence.view is not demo-granted", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: fixture.adminA,
      authUserId: "users_demo_1",
      kind: "shared_demo",
      organizationId: fixture.organizationA,
      storeId: fixture.storeA,
    });

    await expect(
      t.run((ctx) =>
        getHandler(latestArtifact)(ctx, {
          capability: "storeInsights",
          kind: "store_insights",
          storeId: fixture.storeA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps the handler-local full-admin check for a foreign admin", async () => {
    // Admission clamps the store; the handler still proves access to it.
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    accessMocks.requireStoreFullAdminAccess.mockRejectedValue(
      new Error("Store access denied."),
    );

    await expect(
      t.run((ctx) =>
        getHandler(latestArtifact)(asAdmitted(ctx, fixture.adminB), {
          capability: "storeInsights",
          kind: "store_insights",
          storeId: fixture.storeA,
        }),
      ),
    ).rejects.toThrow("Store access denied.");
  });
});

/**
 * An Ask Athena answer committed by admin A. The harness turn views are the
 * only readers of these rows: every one of them reauthorizes the viewer
 * against the turn's own grant, suppression, and egress class. The legacy
 * panel surfaces below carry none of that, so they must not see it.
 */
async function seedAgentAnswer(ctx: MutationCtx, fixture: Fixture) {
  const now = Date.now();
  const runId = await ctx.db.insert("intelligenceRun", {
    actorRef: `athenaUser:${fixture.adminA}`,
    attemptCount: 1,
    capability: "agent:daily_operations",
    createdAt: now + 10,
    debugSubjectId: String(fixture.storeA),
    debugSubjectTable: "store",
    harnessKind: "agent",
    idempotencyKey: "agent:turn-1",
    principalKind: "athenaUser",
    providerKey: "athena_contract_fake",
    sourceRefs: [],
    status: "completed",
    storeId: fixture.storeA,
    trigger: "operator",
    updatedAt: now + 10,
    visibilityMode: "store_admin",
  });
  const artifactId = await ctx.db.insert("intelligenceArtifact", {
    capability: "agent:daily_operations",
    createdAt: now + 11,
    evidenceRefs: [],
    kind: "agent_answer",
    payload: { kind: "agent_answer.v1", outcome: "answer", narrative: "AGENT-ANSWER-NARRATIVE", egressClass: "sensitive", citations: [] },
    runId,
    snapshotHash: "hash-agent",
    sourceRefs: [],
    status: "ready",
    storeId: fixture.storeA,
    subjectId: String(fixture.storeA),
    subjectTable: "store",
    title: "Open shifts",
    updatedAt: now + 11,
    visibilityMode: "store_admin",
  });
  await ctx.db.patch("intelligenceRun", runId, { artifactId });
  return { runId, artifactId };
}

describe("agent answers stay out of the legacy intelligence surfaces", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    accessMocks.requireStoreFullAdminAccess.mockReset();
    accessMocks.requireStoreFullAdminAccess.mockImplementation(
      async (_ctx: unknown, _storeId: unknown) => ({
        athenaUser: { _id: adminAId },
      }),
    );
  });

  it("latestArtifact and latestArtifactBySubject answer null for an agent answer, for the initiating admin and a colleague alike", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    await t.run((ctx) => seedAgentAnswer(ctx, fixture));

    for (const admin of [fixture.adminA, fixture.adminB]) {
      for (const includeDismissed of [undefined, true]) {
        expect(
          await t.run((ctx) =>
            getHandler(latestArtifact)(asAdmitted(ctx, admin), {
              capability: "agent:daily_operations",
              includeDismissed,
              kind: "agent_answer",
              storeId: fixture.storeA,
            }),
          ),
        ).toBeNull();
        expect(
          await t.run((ctx) =>
            getHandler(latestArtifactBySubject)(asAdmitted(ctx, admin), {
              includeDismissed,
              kind: "agent_answer",
              storeId: fixture.storeA,
              subjectId: String(fixture.storeA),
              subjectTable: "store",
            }),
          ),
        ).toBeNull();
      }
    }
    // The legacy panel artifact is untouched by the exclusion.
    const legacy = (await t.run((ctx) =>
      getHandler(latestArtifact)(asAdmitted(ctx, fixture.adminA), {
        capability: "storeInsights",
        kind: "store_insights",
        storeId: fixture.storeA,
      }),
    )) as { _id: Id<"intelligenceArtifact"> } | null;
    expect(legacy?._id).toBe(fixture.artifactA);
  });

  it("latestRunDebug never surfaces an agent run, by capability or by subject", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    await t.run((ctx) => seedAgentAnswer(ctx, fixture));

    for (const admin of [fixture.adminA, fixture.adminB]) {
      expect(
        await t.run((ctx) =>
          getHandler(latestRunDebug)(asAdmitted(ctx, admin), {
            capability: "agent:daily_operations",
            storeId: fixture.storeA,
          }),
        ),
      ).toBeNull();
      expect(
        await t.run((ctx) =>
          getHandler(latestRunDebug)(asAdmitted(ctx, admin), {
            capability: "agent:daily_operations",
            sourceRefId: String(fixture.storeA),
            sourceRefTable: "store",
            storeId: fixture.storeA,
          }),
        ),
      ).toBeNull();
    }
    // A legacy run still debugs.
    expect(
      await t.run((ctx) =>
        getHandler(latestRunDebug)(asAdmitted(ctx, fixture.adminA), {
          capability: "storeInsights",
          storeId: fixture.storeA,
        }),
      ),
    ).not.toBeNull();
  });

  it("dismissArtifact refuses to withdraw an agent answer and leaves it ready", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    const seeded = await t.run((ctx) => seedAgentAnswer(ctx, fixture));

    for (const admin of [fixture.adminA, fixture.adminB]) {
      await expect(
        t.run((ctx) =>
          getHandler(dismissArtifact)(asAdmitted(ctx, admin), { artifactId: seeded.artifactId }),
        ),
      ).rejects.toThrow(/conversation/);
    }
    const artifact = await t.run((ctx) => ctx.db.get("intelligenceArtifact", seeded.artifactId));
    expect(artifact?.status).toBe("ready");
    expect(artifact?.dismissedAt).toBeUndefined();
  });
});

describe("dismissArtifact admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    accessMocks.requireStoreFullAdminAccess.mockReset();
    accessMocks.requireStoreFullAdminAccess.mockImplementation(
      async (_ctx: unknown, _storeId: unknown) => ({
        athenaUser: { _id: adminAId },
      }),
    );
  });

  it("resolves scope from the artifact's own store and dismisses it", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const result = (await t.run((ctx) =>
      getHandler(dismissArtifact)(asAdmitted(ctx, fixture.adminA), {
        artifactId: fixture.artifactA,
      }),
    )) as { status: string };

    expect(result.status).toBe("dismissed");
    const artifact = await t.run((ctx) =>
      ctx.db.get("intelligenceArtifact", fixture.artifactA),
    );
    expect(artifact?.status).toBe("dismissed");
    expect(accessMocks.requireStoreFullAdminAccess).toHaveBeenCalledWith(
      expect.anything(),
      fixture.storeA,
    );
  });

  it("denies an unauthenticated caller before the row is touched", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await expect(
      t.run((ctx) =>
        getHandler(dismissArtifact)(ctx, { artifactId: fixture.artifactA }),
      ),
    ).rejects.toThrow("Sign in again to continue.");

    const artifact = await t.run((ctx) =>
      ctx.db.get("intelligenceArtifact", fixture.artifactA),
    );
    expect(artifact?.status).toBe("ready");
  });

  it("denies a demo principal: intelligence.manage is not demo-granted", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: fixture.adminA,
      authUserId: "users_demo_1",
      kind: "shared_demo",
      organizationId: fixture.organizationA,
      storeId: fixture.storeA,
    });

    await expect(
      t.run((ctx) =>
        getHandler(dismissArtifact)(ctx, { artifactId: fixture.artifactA }),
      ),
    ).rejects.toThrow();

    const artifact = await t.run((ctx) =>
      ctx.db.get("intelligenceArtifact", fixture.artifactA),
    );
    expect(artifact?.status).toBe("ready");
  });
});

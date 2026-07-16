/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  servicePrincipalTables,
  type ServicePrincipalFoundationMutationCtx,
} from "../schemas/servicePrincipals";
import {
  issueServicePrincipalSession,
  reconcileServicePrincipal,
  reconcileServicePrincipalAuthBinding,
  resolveServicePrincipalSession,
  transitionServicePrincipal,
} from "./lifecycle";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.replace(/^\.\.\//, "./"),
    loader,
  ]),
);

const schema = defineSchema({
  organization: defineTable({ name: v.string() }),
  store: defineTable({
    name: v.string(),
    organizationId: v.id("organization"),
  }),
  users: defineTable({}),
  authSessions: defineTable({
    expirationTime: v.number(),
    userId: v.id("users"),
  }).index("userId", ["userId"]),
  ...servicePrincipalTables,
});

function foundationCtx(ctx: unknown) {
  return ctx as ServicePrincipalFoundationMutationCtx;
}

async function seedScope(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organization", { name: "Org" });
    const storeId = await ctx.db.insert("store", {
      name: "Store",
      organizationId,
    });
    return { organizationId, storeId };
  });
}

describe("service-principal lifecycle", () => {
  it("reconciles exactly one stable principal without implicit grants", async () => {
    const t = convexTest(schema, modules);
    const scope = await seedScope(t);

    const results = await Promise.all([
      t.run((ctx) =>
        reconcileServicePrincipal(foundationCtx(ctx), {
          ...scope,
          correlationId: "corr-1",
          now: 100,
          stableKey: "fixture.primary",
        }),
      ),
      t.run((ctx) =>
        reconcileServicePrincipal(foundationCtx(ctx), {
          ...scope,
          correlationId: "corr-2",
          now: 101,
          stableKey: "fixture.primary",
        }),
      ),
    ]);

    expect(new Set(results.map((result) => result.servicePrincipalId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("servicePrincipal").take(10)),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("servicePrincipalCapability").take(10)),
    ).toEqual([]);
  });

  it("keeps stable scope immutable and uses expected lifecycle revisions", async () => {
    const t = convexTest(schema, modules);
    const first = await seedScope(t);
    const second = await seedScope(t);
    const principal = await t.run((ctx) =>
      reconcileServicePrincipal(foundationCtx(ctx), {
        ...first,
        correlationId: "corr-create",
        now: 100,
        stableKey: "fixture.primary",
      }),
    );

    await expect(
      t.run((ctx) =>
        reconcileServicePrincipal(foundationCtx(ctx), {
          organizationId: second.organizationId,
          storeId: second.storeId,
          correlationId: "corr-cross-store",
          now: 101,
          stableKey: "fixture.primary",
          servicePrincipalId: principal.servicePrincipalId,
        }),
      ),
    ).rejects.toThrow("scope_mismatch");

    const disabled = await t.run((ctx) =>
      transitionServicePrincipal(foundationCtx(ctx), {
        servicePrincipalId: principal.servicePrincipalId,
        correlationId: "corr-disable",
        expectedRevision: 1,
        nextStatus: "disabled",
        now: 110,
      }),
    );
    expect(disabled).toMatchObject({ lifecycleRevision: 2, status: "disabled" });

    await expect(
      t.run((ctx) =>
        transitionServicePrincipal(foundationCtx(ctx), {
          servicePrincipalId: principal.servicePrincipalId,
          correlationId: "corr-stale",
          expectedRevision: 1,
          nextStatus: "active",
          now: 111,
        }),
      ),
    ).rejects.toThrow("stale_revision");
  });

  it("makes principal/Auth-user bindings durable and unique in both directions", async () => {
    const t = convexTest(schema, modules);
    const first = await seedScope(t);
    const second = await seedScope(t);
    const [firstUserId, secondUserId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", {}),
      await ctx.db.insert("users", {}),
    ]);
    const firstPrincipal = await t.run((ctx) =>
      reconcileServicePrincipal(foundationCtx(ctx), {
        ...first,
        correlationId: "corr-p1",
        now: 100,
        stableKey: "fixture.primary",
      }),
    );
    const secondPrincipal = await t.run((ctx) =>
      reconcileServicePrincipal(foundationCtx(ctx), {
        ...second,
        correlationId: "corr-p2",
        now: 100,
        stableKey: "fixture.primary",
      }),
    );

    const binding = await t.run((ctx) =>
      reconcileServicePrincipalAuthBinding(foundationCtx(ctx), {
        ...first,
        authUserId: firstUserId,
        correlationId: "corr-bind",
        now: 120,
        servicePrincipalId: firstPrincipal.servicePrincipalId,
      }),
    );
    expect(binding.created).toBe(true);

    await expect(
      t.run((ctx) =>
        reconcileServicePrincipalAuthBinding(foundationCtx(ctx), {
          ...second,
          authUserId: firstUserId,
          correlationId: "corr-rebind-user",
          now: 121,
          servicePrincipalId: secondPrincipal.servicePrincipalId,
        }),
      ),
    ).rejects.toThrow("auth_user_already_bound");

    await expect(
      t.run((ctx) =>
        reconcileServicePrincipalAuthBinding(foundationCtx(ctx), {
          ...first,
          authUserId: secondUserId,
          correlationId: "corr-rebind-principal",
          now: 122,
          servicePrincipalId: firstPrincipal.servicePrincipalId,
        }),
      ),
    ).rejects.toThrow("principal_already_bound");
  });

  it("binds one application session to one exact Auth session", async () => {
    const t = convexTest(schema, modules);
    const scope = await seedScope(t);
    const authUserId = await t.run((ctx) => ctx.db.insert("users", {}));
    const principal = await t.run((ctx) =>
      reconcileServicePrincipal(foundationCtx(ctx), {
        ...scope,
        correlationId: "corr-principal",
        now: 100,
        stableKey: "fixture.primary",
      }),
    );
    const binding = await t.run((ctx) =>
      reconcileServicePrincipalAuthBinding(foundationCtx(ctx), {
        ...scope,
        authUserId,
        correlationId: "corr-binding",
        now: 110,
        servicePrincipalId: principal.servicePrincipalId,
      }),
    );
    const authSessionId = await t.run((ctx) =>
      ctx.db.insert("authSessions", {
        expirationTime: 10_000,
        userId: authUserId,
      }),
    );

    const issued = await t.run((ctx) =>
      issueServicePrincipalSession(foundationCtx(ctx), {
        ...scope,
        absoluteExpiresAt: 1_000,
        authSessionId,
        authUserId,
        capabilityRevision: 3,
        consumerId: "fixture",
        correlationId: "corr-session",
        idleExpiresAt: 500,
        now: 200,
        principalLifecycleRevision: 1,
        requiredCapabilityId: "fixture.application",
        servicePrincipalAuthBindingId: binding.servicePrincipalAuthBindingId,
        servicePrincipalId: principal.servicePrincipalId,
      }),
    );

    await expect(
      t.run((ctx) =>
        issueServicePrincipalSession(foundationCtx(ctx), {
          ...scope,
          absoluteExpiresAt: 1_000,
          authSessionId,
          authUserId,
          capabilityRevision: 3,
          consumerId: "fixture.other",
          correlationId: "corr-conflict",
          idleExpiresAt: 500,
          now: 201,
          principalLifecycleRevision: 1,
          requiredCapabilityId: "fixture.other",
          servicePrincipalAuthBindingId: binding.servicePrincipalAuthBindingId,
          servicePrincipalId: principal.servicePrincipalId,
        }),
      ),
    ).rejects.toThrow("auth_session_already_bound");

    await expect(
      t.run((ctx) =>
        resolveServicePrincipalSession(foundationCtx(ctx), {
          authSessionId,
          authUserId,
          now: 501,
        }),
      ),
    ).rejects.toThrow("session_expired");

    expect(issued.authSessionId).toBe(authSessionId);
  });
});

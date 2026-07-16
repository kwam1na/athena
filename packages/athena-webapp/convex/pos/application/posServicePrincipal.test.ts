/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  servicePrincipalTables,
  type ServicePrincipalFoundationMutationCtx,
} from "../../schemas/servicePrincipals";
import {
  STORE_SERVICE_PRINCIPAL_STABLE_KEY,
  reconcileServicePrincipal,
} from "../../servicePrincipals/lifecycle";
import {
  POS_APPLICATION_CAPABILITY_CATALOG,
  POS_APPLICATION_CAPABILITY_ID,
  POS_SERVICE_PRINCIPAL_CONSUMER_ID,
  enablePosApplicationCapability,
  getPosApplicationAccessStatus,
  reconcilePosServicePrincipal,
  resolvePosApplicationCapability,
  revokePosApplicationCapability,
  setPosApplicationAccess,
} from "./posServicePrincipal";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.ts")).map(([path, loader]) => [
    path.replace(/^\.\.\/\.\.\//, "./"),
    loader,
  ]),
);

const schema = defineSchema({
  organization: defineTable({ name: v.string() }),
  store: defineTable({
    name: v.string(),
    organizationId: v.id("organization"),
  }),
  ...servicePrincipalTables,
});

function foundationCtx(ctx: unknown) {
  return ctx as ServicePrincipalFoundationMutationCtx;
}

async function createScope(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organization", {
      name: `Org ${suffix}`,
    });
    const storeId = await ctx.db.insert("store", {
      name: `Store ${suffix}`,
      organizationId,
    });
    return { organizationId, storeId };
  });
}

describe("POS service-principal adapter", () => {
  it("owns a closed pos.application catalog", () => {
    expect(POS_SERVICE_PRINCIPAL_CONSUMER_ID).toBe("pos");
    expect(STORE_SERVICE_PRINCIPAL_STABLE_KEY).toBe("store.service");
    expect(POS_APPLICATION_CAPABILITY_ID).toBe("pos.application");
    expect(POS_APPLICATION_CAPABILITY_CATALOG.capabilityIds).toEqual([
      "pos.application",
    ]);
    expect(POS_APPLICATION_CAPABILITY_CATALOG.has("pos.application")).toBe(
      true,
    );
    expect(POS_APPLICATION_CAPABILITY_CATALOG.has("pos.unknown")).toBe(false);
  });

  it("idempotently reconciles one canonical principal and POS grant per store", async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, "A");

    const [first, second] = await Promise.all([
      t.run((ctx) =>
        reconcilePosServicePrincipal(foundationCtx(ctx), {
          ...scope,
          correlationId: "corr-pos-reconcile-1",
          now: 100,
        }),
      ),
      t.run((ctx) =>
        reconcilePosServicePrincipal(foundationCtx(ctx), {
          ...scope,
          correlationId: "corr-pos-reconcile-2",
          now: 101,
        }),
      ),
    ]);

    expect(first.servicePrincipalId).toBe(second.servicePrincipalId);
    expect(first.grantId).toBe(second.grantId);
    expect(
      await t.run((ctx) => ctx.db.query("servicePrincipal").take(10)),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("servicePrincipalCapability").take(10)),
    ).toHaveLength(1);
  });

  it("adds POS to an existing neutral store principal instead of creating a POS principal", async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, "A");
    const existing = await t.run((ctx) =>
      reconcileServicePrincipal(foundationCtx(ctx), {
        ...scope,
        correlationId: "corr-store-lifecycle",
        now: 90,
        stableKey: STORE_SERVICE_PRINCIPAL_STABLE_KEY,
      }),
    );

    const reconciled = await t.run((ctx) =>
      reconcilePosServicePrincipal(foundationCtx(ctx), {
        ...scope,
        correlationId: "corr-pos-reconcile",
        now: 100,
      }),
    );

    expect(reconciled.servicePrincipalId).toBe(existing.servicePrincipalId);
    expect(
      await t.run((ctx) => ctx.db.query("servicePrincipal").take(10)),
    ).toHaveLength(1);
  });

  it("enables and revokes only the canonical same-store grant with OCC", async () => {
    const t = convexTest(schema, modules);
    const scopeA = await createScope(t, "A");
    const scopeB = await createScope(t, "B");
    const reconciled = await t.run((ctx) =>
      reconcilePosServicePrincipal(foundationCtx(ctx), {
        ...scopeA,
        correlationId: "corr-pos-reconcile",
        now: 100,
      }),
    );

    const revoked = await t.run((ctx) =>
      revokePosApplicationCapability(foundationCtx(ctx), {
        ...scopeA,
        correlationId: "corr-pos-revoke",
        expectedRevision: 1,
        grantId: reconciled.grantId,
        now: 110,
        servicePrincipalId: reconciled.servicePrincipalId,
      }),
    );
    expect(revoked).toMatchObject({ revision: 2, status: "revoked" });

    await expect(
      t.run((ctx) =>
        resolvePosApplicationCapability(foundationCtx(ctx), {
          ...scopeA,
          now: 111,
          servicePrincipalId: reconciled.servicePrincipalId,
        }),
      ),
    ).rejects.toThrow("capability_inactive");

    await expect(
      t.run((ctx) =>
        enablePosApplicationCapability(foundationCtx(ctx), {
          ...scopeB,
          correlationId: "corr-cross-store",
          expectedRevision: 2,
          grantId: reconciled.grantId,
          now: 112,
          servicePrincipalId: reconciled.servicePrincipalId,
        }),
      ),
    ).rejects.toThrow("scope_mismatch");

    const enabled = await t.run((ctx) =>
      enablePosApplicationCapability(foundationCtx(ctx), {
        ...scopeA,
        correlationId: "corr-pos-enable",
        expectedRevision: 2,
        grantId: reconciled.grantId,
        now: 113,
        servicePrincipalId: reconciled.servicePrincipalId,
      }),
    );
    expect(enabled).toMatchObject({ revision: 3, status: "active" });

    await expect(
      t.run((ctx) =>
        revokePosApplicationCapability(foundationCtx(ctx), {
          ...scopeA,
          correlationId: "corr-stale",
          expectedRevision: 2,
          grantId: reconciled.grantId,
          now: 114,
          servicePrincipalId: reconciled.servicePrincipalId,
        }),
      ),
    ).rejects.toThrow("stale_revision");
  });

  it("reports operator status and applies expected-revision enable, revoke, and re-enable", async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, "Status");

    await expect(
      t.run((ctx) => getPosApplicationAccessStatus(foundationCtx(ctx), scope)),
    ).resolves.toEqual({ grantRevision: 0, status: "not_configured" });

    const enabled = await t.run((ctx) =>
      setPosApplicationAccess(foundationCtx(ctx), {
        ...scope,
        correlationId: "corr-enable",
        enabled: true,
        expectedRevision: 0,
        now: 100,
      }),
    );
    expect(enabled).toMatchObject({ grantRevision: 1, status: "enabled" });

    await expect(
      t.run((ctx) =>
        setPosApplicationAccess(foundationCtx(ctx), {
          ...scope,
          correlationId: "corr-stale-revoke",
          enabled: false,
          expectedRevision: 0,
          now: 101,
        }),
      ),
    ).rejects.toThrow("stale_revision");

    const revoked = await t.run((ctx) =>
      setPosApplicationAccess(foundationCtx(ctx), {
        ...scope,
        correlationId: "corr-revoke",
        enabled: false,
        expectedRevision: 1,
        now: 102,
      }),
    );
    expect(revoked).toMatchObject({ grantRevision: 2, status: "revoked" });

    const reenabled = await t.run((ctx) =>
      setPosApplicationAccess(foundationCtx(ctx), {
        ...scope,
        correlationId: "corr-reenable",
        enabled: true,
        expectedRevision: 2,
        now: 103,
      }),
    );
    expect(reenabled).toMatchObject({
      grantRevision: 3,
      status: "enabled",
    });
  });
});

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
  defineServicePrincipalCapabilityCatalog,
  reconcileServicePrincipalCapabilityGrant,
  resolveActiveServicePrincipalCapability,
  transitionServicePrincipalCapabilityGrant,
} from "./capabilities";
import { reconcileServicePrincipal } from "./lifecycle";

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
  ...servicePrincipalTables,
});

function foundationCtx(ctx: unknown) {
  return ctx as ServicePrincipalFoundationMutationCtx;
}

const catalog = defineServicePrincipalCapabilityCatalog("fixture", [
  "fixture.application",
  "fixture.sync",
] as const);

describe("service-principal capabilities", () => {
  it("rejects duplicate, cross-consumer, and unknown declarations", () => {
    expect(() =>
      defineServicePrincipalCapabilityCatalog("fixture", [
        "fixture.application",
        "fixture.application",
      ]),
    ).toThrow("duplicate_capability");
    expect(() =>
      defineServicePrincipalCapabilityCatalog("fixture", ["other.application"]),
    ).toThrow("capability_namespace_mismatch");
    expect(catalog.has("fixture.unknown")).toBe(false);
  });

  it("deduplicates only an explicitly requested grant and defaults to deny", async () => {
    const t = convexTest(schema, modules);
    const scope = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organization", { name: "Org" });
      const storeId = await ctx.db.insert("store", {
        name: "Store",
        organizationId,
      });
      return { organizationId, storeId };
    });
    const principal = await t.run((ctx) =>
      reconcileServicePrincipal(foundationCtx(ctx), {
        ...scope,
        correlationId: "corr-principal",
        now: 100,
        stableKey: "fixture.primary",
      }),
    );

    await expect(
      t.run((ctx) =>
        resolveActiveServicePrincipalCapability(foundationCtx(ctx), {
          ...scope,
          capabilityId: "fixture.application",
          catalog,
          consumerId: "fixture",
          now: 101,
          servicePrincipalId: principal.servicePrincipalId,
        }),
      ),
    ).rejects.toThrow("capability_absent");

    const results = await Promise.all([
      t.run((ctx) =>
        reconcileServicePrincipalCapabilityGrant(foundationCtx(ctx), {
          ...scope,
          capabilityId: "fixture.application",
          catalog,
          consumerId: "fixture",
          correlationId: "corr-grant-1",
          now: 102,
          servicePrincipalId: principal.servicePrincipalId,
        }),
      ),
      t.run((ctx) =>
        reconcileServicePrincipalCapabilityGrant(foundationCtx(ctx), {
          ...scope,
          capabilityId: "fixture.application",
          catalog,
          consumerId: "fixture",
          correlationId: "corr-grant-2",
          now: 103,
          servicePrincipalId: principal.servicePrincipalId,
        }),
      ),
    ]);

    expect(new Set(results.map((result) => result.grantId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("servicePrincipalCapability").take(10)),
    ).toHaveLength(1);
  });

  it("fails closed for revoked, expired, stale, and cross-store grants", async () => {
    const t = convexTest(schema, modules);
    const scope = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organization", { name: "Org" });
      const storeId = await ctx.db.insert("store", {
        name: "Store",
        organizationId,
      });
      return { organizationId, storeId };
    });
    const principal = await t.run((ctx) =>
      reconcileServicePrincipal(foundationCtx(ctx), {
        ...scope,
        correlationId: "corr-principal",
        now: 100,
        stableKey: "fixture.primary",
      }),
    );
    const grant = await t.run((ctx) =>
      reconcileServicePrincipalCapabilityGrant(foundationCtx(ctx), {
        ...scope,
        capabilityId: "fixture.application",
        catalog,
        consumerId: "fixture",
        correlationId: "corr-grant",
        expiresAt: 200,
        now: 101,
        servicePrincipalId: principal.servicePrincipalId,
      }),
    );

    await expect(
      t.run((ctx) =>
        resolveActiveServicePrincipalCapability(foundationCtx(ctx), {
          ...scope,
          capabilityId: "fixture.application",
          catalog,
          consumerId: "fixture",
          now: 200,
          servicePrincipalId: principal.servicePrincipalId,
        }),
      ),
    ).rejects.toThrow("capability_expired");

    const revoked = await t.run((ctx) =>
      transitionServicePrincipalCapabilityGrant(foundationCtx(ctx), {
        correlationId: "corr-revoke",
        expectedRevision: 1,
        grantId: grant.grantId,
        nextStatus: "revoked",
        now: 150,
      }),
    );
    expect(revoked.revision).toBe(2);

    await expect(
      t.run((ctx) =>
        transitionServicePrincipalCapabilityGrant(foundationCtx(ctx), {
          correlationId: "corr-stale",
          expectedRevision: 1,
          grantId: grant.grantId,
          nextStatus: "active",
          now: 151,
        }),
      ),
    ).rejects.toThrow("stale_revision");
  });
});

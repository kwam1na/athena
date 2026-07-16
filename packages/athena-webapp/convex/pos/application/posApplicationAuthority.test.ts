/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { posServicePrincipalConsumerTables } from "../../schemas/pos";
import { servicePrincipalTables } from "../../schemas/servicePrincipals";
import { STORE_SERVICE_PRINCIPAL_STABLE_KEY } from "../../servicePrincipals/lifecycle";
import { requirePosApplicationAuthorityWithCtx } from "./posApplicationAuthority";
import {
  POS_APPLICATION_CAPABILITY_ID,
  POS_SERVICE_PRINCIPAL_CONSUMER_ID,
} from "./posServicePrincipal";

const mocks = vi.hoisted(() => ({
  requireServicePrincipalActorWithCtx: vi.fn(),
}));

vi.mock("../../servicePrincipals/actor", () => ({
  requireServicePrincipalActorWithCtx:
    mocks.requireServicePrincipalActorWithCtx,
}));

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
  users: defineTable({ email: v.string() }),
  authSessions: defineTable({
    expirationTime: v.number(),
    userId: v.id("users"),
  }),
  athenaUser: defineTable({ name: v.string() }),
  ...servicePrincipalTables,
  ...posServicePrincipalConsumerTables,
});

type SeededAuthority = Awaited<ReturnType<typeof seedAuthority>>;

async function seedAuthority(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organization", { name: "Org" });
    const storeId = await ctx.db.insert("store", {
      name: "Store",
      organizationId,
    });
    const authUserId = await ctx.db.insert("users", { email: "service@test" });
    const authSessionId = await ctx.db.insert("authSessions", {
      expirationTime: 10_000,
      userId: authUserId,
    });
    const registeredByUserId = await ctx.db.insert("athenaUser", {
      name: "Admin",
    });
    const servicePrincipalId = await ctx.db.insert("servicePrincipal", {
      organizationId,
      storeId,
      stableKey: STORE_SERVICE_PRINCIPAL_STABLE_KEY,
      status: "active",
      lifecycleRevision: 3,
      createdAt: 1,
      updatedAt: 1,
      lastCorrelationId: "principal",
    });
    const servicePrincipalAuthBindingId = await ctx.db.insert(
      "servicePrincipalAuthBinding",
      {
        organizationId,
        storeId,
        servicePrincipalId,
        authUserId,
        status: "active",
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
        lastCorrelationId: "auth-binding",
      },
    );
    const capabilityGrantId = await ctx.db.insert(
      "servicePrincipalCapability",
      {
        organizationId,
        storeId,
        servicePrincipalId,
        consumerId: POS_SERVICE_PRINCIPAL_CONSUMER_ID,
        capabilityId: POS_APPLICATION_CAPABILITY_ID,
        status: "active",
        revision: 5,
        grantedAt: 1,
        updatedAt: 1,
        lastCorrelationId: "grant",
      },
    );
    const servicePrincipalSessionId = await ctx.db.insert(
      "servicePrincipalSession",
      {
        organizationId,
        storeId,
        servicePrincipalId,
        servicePrincipalAuthBindingId,
        authUserId,
        authSessionId,
        consumerId: POS_SERVICE_PRINCIPAL_CONSUMER_ID,
        requiredCapabilityId: POS_APPLICATION_CAPABILITY_ID,
        principalLifecycleRevision: 3,
        capabilityRevision: 5,
        status: "active",
        revision: 2,
        issuedAt: 1,
        lastSeenAt: 1,
        idleExpiresAt: 5_000,
        absoluteExpiresAt: 10_000,
        updatedAt: 1,
        lastCorrelationId: "session",
      },
    );
    const posRecoveryCredentialId = await ctx.db.insert(
      "posRecoveryCredential",
      {
        codeHash: "hash",
        codeSalt: "salt",
        codeVersion: 1,
        createdAt: 1,
        failedAttemptCount: 0,
        organizationId,
        posAccountId: registeredByUserId,
        servicePrincipalId,
        credentialRevision: 7,
        rotatedAt: 1,
        status: "active",
        storeId,
      },
    );
    const terminalId = await ctx.db.insert("posTerminal", {
      organizationId,
      storeId,
      fingerprintHash: "fingerprint",
      displayName: "Front",
      registeredByUserId,
      browserInfo: { userAgent: "test" },
      registeredAt: 1,
      lifecycleRevision: 11,
      proofRevision: 13,
      status: "active",
    });
    const posApplicationSessionBindingId = await ctx.db.insert(
      "posApplicationSessionBinding",
      {
        organizationId,
        storeId,
        servicePrincipalId,
        servicePrincipalSessionId,
        terminalId,
        posRecoveryCredentialId,
        capabilityGrantId,
        consumerId: POS_SERVICE_PRINCIPAL_CONSUMER_ID,
        capabilityId: POS_APPLICATION_CAPABILITY_ID,
        status: "active",
        revision: 1,
        principalLifecycleRevision: 3,
        capabilityRevision: 5,
        credentialRevision: 7,
        terminalLifecycleRevision: 11,
        terminalProofRevision: 13,
        offlineAuthorityReceipt: "offline-receipt-1",
        activatedAt: 1,
        updatedAt: 1,
        lastCorrelationId: "pos-binding",
      },
    );
    return {
      authSessionId,
      authUserId,
      capabilityGrantId,
      organizationId,
      posApplicationSessionBindingId,
      posRecoveryCredentialId,
      servicePrincipalAuthBindingId,
      servicePrincipalId,
      servicePrincipalSessionId,
      storeId,
      terminalId,
    };
  });
}

function actorFor(seed: SeededAuthority) {
  return {
    kind: "service_principal" as const,
    absoluteExpiresAt: 10_000,
    authSessionId: seed.authSessionId,
    authUserId: seed.authUserId,
    capabilityRevision: 5,
    consumerId: POS_SERVICE_PRINCIPAL_CONSUMER_ID,
    idleExpiresAt: 5_000,
    organizationId: seed.organizationId,
    principalLifecycleRevision: 3,
    requiredCapabilityId: POS_APPLICATION_CAPABILITY_ID,
    servicePrincipalAuthBindingId: seed.servicePrincipalAuthBindingId,
    servicePrincipalId: seed.servicePrincipalId,
    servicePrincipalSessionId: seed.servicePrincipalSessionId,
    sessionRevision: 2,
    storeId: seed.storeId,
  };
}

function patchTestRow(
  ctx: unknown,
  table: string,
  id: string,
  patch: Readonly<Record<string, unknown>>,
) {
  const db = (
    ctx as {
      db: {
        patch: (
          tableName: string,
          rowId: string,
          value: Readonly<Record<string, unknown>>,
        ) => Promise<unknown>;
      };
    }
  ).db;
  return db.patch(table, id, patch);
}

describe("POS application authority", () => {
  beforeEach(() => {
    mocks.requireServicePrincipalActorWithCtx.mockReset();
  });

  it("returns one exact store-clamped application authority", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedAuthority(t);
    mocks.requireServicePrincipalActorWithCtx.mockResolvedValue(actorFor(seeded));

    const authority = await t.run((ctx) =>
      requirePosApplicationAuthorityWithCtx(ctx as never, {
        now: 100,
        storeId: seeded.storeId,
      }),
    );

    expect(authority).toMatchObject({
      capabilityGrantId: seeded.capabilityGrantId,
      credentialId: seeded.posRecoveryCredentialId,
      organizationId: seeded.organizationId,
      offlineAuthorityReceipt: "offline-receipt-1",
      posApplicationSessionBindingId:
        seeded.posApplicationSessionBindingId,
      servicePrincipalId: seeded.servicePrincipalId,
      servicePrincipalSessionId: seeded.servicePrincipalSessionId,
      storeId: seeded.storeId,
      terminalId: seeded.terminalId,
    });
  });

  it("rejects client-supplied cross-store scope", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedAuthority(t);
    const otherStoreId = await t.run((ctx) =>
      ctx.db.insert("store", {
        name: "Other",
        organizationId: seeded.organizationId,
      }),
    );
    mocks.requireServicePrincipalActorWithCtx.mockResolvedValue(actorFor(seeded));

    await expect(
      t.run((ctx) =>
        requirePosApplicationAuthorityWithCtx(ctx as never, {
          now: 100,
          storeId: otherStoreId,
        }),
      ),
    ).rejects.toThrow("no longer authorized");
  });

  it.each([
    ["service session", "servicePrincipalSession", { status: "revoked" }],
    ["principal", "servicePrincipal", { status: "revoked" }],
    ["grant", "servicePrincipalCapability", { status: "revoked" }],
    ["credential", "posRecoveryCredential", { status: "revoked" }],
    ["terminal", "posTerminal", { status: "revoked" }],
    ["POS binding", "posApplicationSessionBinding", { status: "revoked" }],
  ] as const)("rejects a revoked %s", async (_label, table, patch) => {
    const t = convexTest(schema, modules);
    const seeded = await seedAuthority(t);
    mocks.requireServicePrincipalActorWithCtx.mockResolvedValue(actorFor(seeded));
    const idByTable = {
      servicePrincipalSession: seeded.servicePrincipalSessionId,
      servicePrincipal: seeded.servicePrincipalId,
      servicePrincipalCapability: seeded.capabilityGrantId,
      posRecoveryCredential: seeded.posRecoveryCredentialId,
      posTerminal: seeded.terminalId,
      posApplicationSessionBinding: seeded.posApplicationSessionBindingId,
    } as const;
    await t.run((ctx) =>
      patchTestRow(ctx, table, idByTable[table], patch),
    );

    await expect(
      t.run((ctx) =>
        requirePosApplicationAuthorityWithCtx(ctx as never, { now: 100 }),
      ),
    ).rejects.toThrow("no longer authorized");
  });

  it("rejects missing store and every captured revision mismatch", async () => {
    const mutations = [
      ["servicePrincipal", "lifecycleRevision", 4],
      ["servicePrincipalCapability", "revision", 6],
      ["posRecoveryCredential", "credentialRevision", 8],
      ["posTerminal", "lifecycleRevision", 12],
      ["posTerminal", "proofRevision", 14],
    ] as const;

    for (const [table, field, value] of mutations) {
      const t = convexTest(schema, modules);
      const seeded = await seedAuthority(t);
      mocks.requireServicePrincipalActorWithCtx.mockResolvedValue(actorFor(seeded));
      const idByTable = {
        servicePrincipal: seeded.servicePrincipalId,
        servicePrincipalCapability: seeded.capabilityGrantId,
        posRecoveryCredential: seeded.posRecoveryCredentialId,
        posTerminal: seeded.terminalId,
      } as const;
      await t.run((ctx) =>
        patchTestRow(ctx, table, idByTable[table], { [field]: value }),
      );
      await expect(
        t.run((ctx) =>
          requirePosApplicationAuthorityWithCtx(ctx as never, { now: 100 }),
        ),
      ).rejects.toThrow("no longer authorized");
    }

    const t = convexTest(schema, modules);
    const seeded = await seedAuthority(t);
    mocks.requireServicePrincipalActorWithCtx.mockResolvedValue(actorFor(seeded));
    await t.run((ctx) => ctx.db.delete("store", seeded.storeId));
    await expect(
      t.run((ctx) =>
        requirePosApplicationAuthorityWithCtx(ctx as never, { now: 100 }),
      ),
    ).rejects.toThrow("no longer authorized");
  });
});

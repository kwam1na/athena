/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import { servicePrincipalTables } from "../servicePrincipals";
import {
  posRecoveryCredentialSchema,
  posServicePrincipalConsumerTables,
  posTerminalSchema,
} from ".";

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
  athenaUser: defineTable({ email: v.string() }),
  users: defineTable({ name: v.optional(v.string()) }),
  authSessions: defineTable({
    expirationTime: v.number(),
    userId: v.id("users"),
  }),
  posTerminal: defineTable(posTerminalSchema),
  posRecoveryCredential: defineTable(posRecoveryCredentialSchema),
  ...servicePrincipalTables,
  ...posServicePrincipalConsumerTables,
});

describe("POS service-principal consumer schemas", () => {
  it("supports exact binding lineage and terminal-scoped status indexes", async () => {
    const t = convexTest(schema, modules);
    const inserted = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organization", { name: "Org" });
      const storeId = await ctx.db.insert("store", {
        name: "Store",
        organizationId,
      });
      const userId = await ctx.db.insert("athenaUser", { email: "admin@example.com" });
      const authUserId = await ctx.db.insert("users", {});
      const authSessionId = await ctx.db.insert("authSessions", {
        expirationTime: 1_000,
        userId: authUserId,
      });
      const servicePrincipalId = await ctx.db.insert("servicePrincipal", {
        organizationId,
        storeId,
        stableKey: "store.service",
        status: "active",
        lifecycleRevision: 1,
        createdAt: 1,
        updatedAt: 1,
        lastCorrelationId: "corr-principal",
      });
      const grantId = await ctx.db.insert("servicePrincipalCapability", {
        organizationId,
        storeId,
        servicePrincipalId,
        consumerId: "pos",
        capabilityId: "pos.application",
        status: "active",
        revision: 1,
        grantedAt: 1,
        updatedAt: 1,
        lastCorrelationId: "corr-grant",
      });
      const authBindingId = await ctx.db.insert("servicePrincipalAuthBinding", {
        organizationId,
        storeId,
        servicePrincipalId,
        authUserId,
        status: "active",
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
        lastCorrelationId: "corr-auth-binding",
      });
      const servicePrincipalSessionId = await ctx.db.insert(
        "servicePrincipalSession",
        {
          organizationId,
          storeId,
          servicePrincipalId,
          servicePrincipalAuthBindingId: authBindingId,
          authUserId,
          authSessionId,
          consumerId: "pos",
          requiredCapabilityId: "pos.application",
          principalLifecycleRevision: 1,
          capabilityRevision: 1,
          status: "active",
          revision: 1,
          issuedAt: 1,
          lastSeenAt: 1,
          idleExpiresAt: 500,
          absoluteExpiresAt: 1_000,
          updatedAt: 1,
          lastCorrelationId: "corr-session",
        },
      );
      const terminalId = await ctx.db.insert("posTerminal", {
        organizationId,
        storeId,
        fingerprintHash: "fingerprint",
        syncSecretHash: "proof",
        displayName: "Front register",
        registeredByUserId: userId,
        browserInfo: { userAgent: "test" },
        registeredAt: 1,
        status: "active",
        lifecycleRevision: 1,
        proofRevision: 1,
        lastCorrelationId: "corr-terminal",
      });
      const credentialId = await ctx.db.insert("posRecoveryCredential", {
        createdAt: 1,
        failedAttemptCount: 0,
        organizationId,
        posAccountId: userId,
        rotatedAt: 1,
        status: "active",
        storeId,
        servicePrincipalId,
        credentialRevision: 1,
        verifierKind: "deployment_keyed_pbkdf2_sha256",
        keyedVerifierDigest: "digest",
        keyedVerifierSalt: "salt",
        keyedVerifierIterations: 600_000,
        keyedVerifierPepperVersion: 1,
        keyedVerifierVersion: 1,
        plaintextRemovedAt: 1,
        legacyMigrationAt: 1,
        legacyMigrationStatus: "migrated",
        lastCorrelationId: "corr-credential",
      });
      const bindingId = await ctx.db.insert("posApplicationSessionBinding", {
        organizationId,
        storeId,
        servicePrincipalId,
        servicePrincipalSessionId,
        terminalId,
        posRecoveryCredentialId: credentialId,
        capabilityGrantId: grantId,
        consumerId: "pos",
        capabilityId: "pos.application",
        status: "active",
        revision: 1,
        principalLifecycleRevision: 1,
        capabilityRevision: 1,
        credentialRevision: 1,
        terminalLifecycleRevision: 1,
        terminalProofRevision: 1,
        activatedAt: 1,
        updatedAt: 1,
        lastCorrelationId: "corr-pos-binding",
      });
      return {
        bindingId,
        credentialId,
        servicePrincipalId,
        servicePrincipalSessionId,
        terminalId,
      };
    });

    const bySession = await t.run((ctx) =>
      ctx.db
        .query("posApplicationSessionBinding")
        .withIndex("by_servicePrincipalSessionId", (q) =>
          q.eq("servicePrincipalSessionId", inserted.servicePrincipalSessionId),
        )
        .unique(),
    );
    const byLineage = await t.run((ctx) =>
      ctx.db
        .query("posApplicationSessionBinding")
        .withIndex(
          "by_servicePrincipalId_and_terminalId_and_consumerId_and_status",
          (q) =>
            q
              .eq("servicePrincipalId", inserted.servicePrincipalId)
              .eq("terminalId", inserted.terminalId)
              .eq("consumerId", "pos")
              .eq("status", "active"),
        )
        .take(2),
    );
    expect(bySession?._id).toBe(inserted.bindingId);
    expect(byLineage).toHaveLength(1);
    const credential = await t.run((ctx) =>
      ctx.db.get("posRecoveryCredential", inserted.credentialId),
    );
    expect(credential).not.toHaveProperty("codeHash");
    expect(credential).not.toHaveProperty("codeSalt");
    expect(credential).not.toHaveProperty("plaintextCode");
    expect(credential).toMatchObject({
      legacyMigrationStatus: "migrated",
      verifierKind: "deployment_keyed_pbkdf2_sha256",
    });
  });

  it("supports exact exchange replay and bounded expiry cleanup indexes", async () => {
    const t = convexTest(schema, modules);
    const row = await seedRecoveryScope(t);
    const exchangeId = await t.run((ctx) =>
      ctx.db.insert("posRecoveryExchange", {
        ...row,
        recoveryCorrelationKey: "client-correlation",
        consumerId: "pos",
        capabilityId: "pos.application",
        status: "prepared",
        revision: 1,
        principalLifecycleRevision: 1,
        capabilityRevision: 1,
        credentialRevision: 1,
        terminalLifecycleRevision: 1,
        terminalProofRevision: 1,
        preparedAt: 10,
        updatedAt: 10,
        expiresAt: 20,
        lastCorrelationId: "corr-exchange",
      }),
    );

    const exact = await t.run((ctx) =>
      ctx.db
        .query("posRecoveryExchange")
        .withIndex("by_recoveryCorrelationKey", (q) =>
          q.eq("recoveryCorrelationKey", "client-correlation"),
        )
        .unique(),
    );
    const expired = await t.run((ctx) =>
      ctx.db
        .query("posRecoveryExchange")
        .withIndex("by_status_and_expiresAt", (q) =>
          q.eq("status", "prepared").lte("expiresAt", 20),
        )
        .take(10),
    );
    expect(exact?._id).toBe(exchangeId);
    expect(expired).toHaveLength(1);
  });

  it("stores only reconnect intent hashes and indexes single-use cleanup", async () => {
    const t = convexTest(schema, modules);
    const row = await seedRecoveryScope(t);
    const intentId = await t.run((ctx) =>
      ctx.db.insert("posTerminalReconnectIntent", {
        organizationId: row.organizationId,
        storeId: row.storeId,
        terminalId: row.terminalId,
        intentTokenHash: "intent-hash",
        browserFingerprintHash: "fingerprint",
        status: "pending",
        terminalLifecycleRevision: 2,
        terminalProofRevision: 1,
        issuedAt: 10,
        updatedAt: 10,
        expiresAt: 20,
        lastCorrelationId: "corr-intent",
      }),
    );

    const exact = await t.run((ctx) =>
      ctx.db
        .query("posTerminalReconnectIntent")
        .withIndex("by_intentTokenHash", (q) =>
          q.eq("intentTokenHash", "intent-hash"),
        )
        .unique(),
    );
    const cleanup = await t.run((ctx) =>
      ctx.db
        .query("posTerminalReconnectIntent")
        .withIndex("by_status_and_expiresAt", (q) =>
          q.eq("status", "pending").lte("expiresAt", 20),
        )
        .take(10),
    );
    expect(exact?._id).toBe(intentId);
    expect(exact).not.toHaveProperty("intentToken");
    expect(cleanup).toHaveLength(1);
  });
});

async function seedRecoveryScope(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organization", { name: "Org" });
    const storeId = await ctx.db.insert("store", {
      name: "Store",
      organizationId,
    });
    const userId = await ctx.db.insert("athenaUser", { email: "admin@example.com" });
    const authUserId = await ctx.db.insert("users", {});
    const authSessionId = await ctx.db.insert("authSessions", {
      expirationTime: 1_000,
      userId: authUserId,
    });
    const servicePrincipalId = await ctx.db.insert("servicePrincipal", {
      organizationId,
      storeId,
      stableKey: "store.service",
      status: "active",
      lifecycleRevision: 1,
      createdAt: 1,
      updatedAt: 1,
      lastCorrelationId: "corr-principal",
    });
    const capabilityGrantId = await ctx.db.insert("servicePrincipalCapability", {
      organizationId,
      storeId,
      servicePrincipalId,
      consumerId: "pos",
      capabilityId: "pos.application",
      status: "active",
      revision: 1,
      grantedAt: 1,
      updatedAt: 1,
      lastCorrelationId: "corr-grant",
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
        lastCorrelationId: "corr-auth-binding",
      },
    );
    const terminalId = await ctx.db.insert("posTerminal", {
      organizationId,
      storeId,
      fingerprintHash: "fingerprint",
      syncSecretHash: "proof",
      displayName: "Front register",
      registeredByUserId: userId,
      browserInfo: { userAgent: "test" },
      registeredAt: 1,
      status: "active",
      lifecycleRevision: 1,
      proofRevision: 1,
      lastCorrelationId: "corr-terminal",
    });
    const posRecoveryCredentialId = await ctx.db.insert(
      "posRecoveryCredential",
      {
        codeHash: "legacy-hash",
        codeSalt: "legacy-salt",
        codeVersion: 1,
        createdAt: 1,
        failedAttemptCount: 0,
        organizationId,
        posAccountId: userId,
        rotatedAt: 1,
        status: "active",
        storeId,
        servicePrincipalId,
        credentialRevision: 1,
      },
    );
    return {
      organizationId,
      storeId,
      servicePrincipalId,
      servicePrincipalAuthBindingId,
      authUserId,
      authSessionId,
      terminalId,
      posRecoveryCredentialId,
      capabilityGrantId,
    };
  });
}

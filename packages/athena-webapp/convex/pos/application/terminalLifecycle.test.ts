/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import { posServicePrincipalConsumerTables } from "../../schemas/pos";
import { posTerminalSchema } from "../../schemas/pos/posTerminal";
import { servicePrincipalTables } from "../../schemas/servicePrincipals";
import {
  disconnectPosTerminal,
  findActiveTerminalFingerprintConflict,
  issueRevokedPosTerminalReconnectIntent,
  reactivatePosTerminal,
  reassignPosTerminal,
  resolvePosTerminalReconnectIntent,
  rotatePosTerminalProof,
} from "./terminalLifecycle";

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
  authSessions: defineTable({ expirationTime: v.number(), userId: v.id("users") }),
  posRecoveryCredential: defineTable({ storeId: v.id("store") }),
  posTerminal: defineTable(posTerminalSchema)
    .index("by_fingerprintHash", ["fingerprintHash"])
    .index("by_storeId_and_fingerprintHash", ["storeId", "fingerprintHash"])
    .index("by_storeId_registerNumber", ["storeId", "registerNumber"]),
  ...servicePrincipalTables,
  ...posServicePrincipalConsumerTables,
});

describe("POS terminal lifecycle", () => {
  it("detects an active fingerprint in another store", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTerminals(t);

    const conflict = await t.run((ctx) =>
      findActiveTerminalFingerprintConflict(ctx as never, {
        fingerprintHash: "fingerprint-a",
        targetStoreId: seeded.storeBId,
      }),
    );

    expect(conflict?._id).toBe(seeded.terminalAId);
    expect(conflict?.storeId).toBe(seeded.storeAId);
  });

  it("rotates proof only for the same active terminal with its current proof", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTerminals(t);

    await expect(
      t.run((ctx) =>
        rotatePosTerminalProof(ctx as never, {
          correlationId: "corr-wrong-proof",
          currentProofHash: "wrong-proof",
          fingerprintHash: "fingerprint-a",
          nextProofHash: "proof-a-2",
          now: 100,
          storeId: seeded.storeAId,
          terminalId: seeded.terminalAId,
        }),
      ),
    ).rejects.toThrow("terminal_proof_invalid");

    const rotated = await t.run((ctx) =>
      rotatePosTerminalProof(ctx as never, {
        correlationId: "corr-rotate",
        currentProofHash: "proof-a-1",
        fingerprintHash: "fingerprint-a",
        nextProofHash: "proof-a-2",
        now: 101,
        storeId: seeded.storeAId,
        terminalId: seeded.terminalAId,
      }),
    );

    expect(rotated).toMatchObject({
      terminalId: seeded.terminalAId,
      lifecycleRevision: 1,
      proofRevision: 2,
    });
    expect(
      await t.run((ctx) => ctx.db.get("posTerminal", seeded.terminalAId)),
    ).toMatchObject({ syncSecretHash: "proof-a-2", proofRevision: 2 });
  });

  it("disconnects only the named terminal and its active application binding", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTerminals(t, { withBindings: true });

    const disconnected = await t.run((ctx) =>
      disconnectPosTerminal(ctx as never, {
        correlationId: "corr-disconnect",
        disconnectedByUserId: seeded.adminId,
        now: 200,
        storeId: seeded.storeAId,
        terminalId: seeded.terminalAId,
      }),
    );

    expect(disconnected).toMatchObject({
      lifecycleRevision: 2,
      proofRevision: 2,
      status: "revoked",
      terminalId: seeded.terminalAId,
    });
    expect(
      await t.run((ctx) => ctx.db.get("posTerminal", seeded.terminalBId)),
    ).toMatchObject({ status: "active", lifecycleRevision: 1, proofRevision: 1 });
    expect(
      await t.run((ctx) =>
        ctx.db.get("posApplicationSessionBinding", seeded.bindingAId!),
      ),
    ).toMatchObject({ status: "revoked", revision: 2 });
    expect(
      await t.run((ctx) =>
        ctx.db.get("posApplicationSessionBinding", seeded.bindingBId!),
      ),
    ).toMatchObject({ status: "active", revision: 1 });
    expect(
      await t.run((ctx) => ctx.db.get("servicePrincipal", seeded.principalId!)),
    ).toMatchObject({ status: "active", lifecycleRevision: 1 });
    expect(
      await t.run((ctx) =>
        ctx.db.get("servicePrincipalCapability", seeded.grantId!),
      ),
    ).toMatchObject({ status: "active", revision: 1 });
  });

  it("reactivates the same row only with a live same-browser intent and consumes replay", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTerminals(t);
    await t.run((ctx) =>
      disconnectPosTerminal(ctx as never, {
        correlationId: "corr-disconnect",
        disconnectedByUserId: seeded.adminId,
        now: 200,
        storeId: seeded.storeAId,
        terminalId: seeded.terminalAId,
      }),
    );
    const intentId = await t.run((ctx) =>
      ctx.db.insert("posTerminalReconnectIntent", {
        organizationId: seeded.organizationId,
        storeId: seeded.storeAId,
        terminalId: seeded.terminalAId,
        intentTokenHash: "intent-hash",
        browserFingerprintHash: "fingerprint-a",
        status: "pending",
        terminalLifecycleRevision: 2,
        terminalProofRevision: 2,
        issuedAt: 201,
        updatedAt: 201,
        expiresAt: 300,
        lastCorrelationId: "corr-intent",
      }),
    );

    await expect(
      t.run((ctx) =>
        reactivatePosTerminal(ctx as never, {
          browserFingerprintHash: "different-browser",
          correlationId: "corr-wrong-browser",
          intentTokenHash: "intent-hash",
          nextProofHash: "proof-a-3",
          now: 220,
          reactivatedByUserId: seeded.adminId,
          storeId: seeded.storeAId,
          terminalId: seeded.terminalAId,
        }),
      ),
    ).rejects.toThrow("reconnect_intent_invalid");

    const reactivated = await t.run((ctx) =>
      reactivatePosTerminal(ctx as never, {
        browserFingerprintHash: "fingerprint-a",
        correlationId: "corr-reactivate",
        intentTokenHash: "intent-hash",
        nextProofHash: "proof-a-3",
        now: 221,
        reactivatedByUserId: seeded.adminId,
        storeId: seeded.storeAId,
        terminalId: seeded.terminalAId,
      }),
    );
    expect(reactivated).toMatchObject({
      terminalId: seeded.terminalAId,
      storeId: seeded.storeAId,
      lifecycleRevision: 3,
      proofRevision: 3,
      status: "active",
    });
    expect(
      await t.run((ctx) => ctx.db.get("posTerminalReconnectIntent", intentId)),
    ).toMatchObject({ status: "consumed", consumedByUserId: seeded.adminId });
    await expect(
      t.run((ctx) =>
        reactivatePosTerminal(ctx as never, {
          browserFingerprintHash: "fingerprint-a",
          correlationId: "corr-replay",
          intentTokenHash: "intent-hash",
          nextProofHash: "proof-a-4",
          now: 222,
          reactivatedByUserId: seeded.adminId,
          storeId: seeded.storeAId,
          terminalId: seeded.terminalAId,
        }),
      ),
    ).rejects.toThrow("reconnect_intent_invalid");
  });

  it("issues bounded single-live reconnect intents only for the revoked row's exact proof and browser", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTerminals(t);
    await t.run((ctx) =>
      disconnectPosTerminal(ctx as never, {
        correlationId: "corr-disconnect-intent",
        disconnectedByUserId: seeded.adminId,
        now: 200,
        storeId: seeded.storeAId,
        terminalId: seeded.terminalAId,
      }),
    );

    for (const invalid of [
      { currentProofHash: "wrong-proof", browserFingerprintHash: "fingerprint-a" },
      { currentProofHash: "proof-a-1", browserFingerprintHash: "fingerprint-b" },
    ]) {
      await expect(
        t.run((ctx) =>
          issueRevokedPosTerminalReconnectIntent(ctx as never, {
            ...invalid,
            correlationId: "corr-invalid-intent",
            intentTokenHash: "invalid-intent-hash",
            now: 201,
            terminalId: seeded.terminalAId,
          }),
        ),
      ).rejects.toThrow("reconnect_intent_invalid");
    }

    const first = await t.run((ctx) =>
      issueRevokedPosTerminalReconnectIntent(ctx as never, {
        browserFingerprintHash: "fingerprint-a",
        correlationId: "corr-intent-1",
        currentProofHash: "proof-a-1",
        intentTokenHash: "intent-hash-1",
        now: 202,
        terminalId: seeded.terminalAId,
      }),
    );
    const second = await t.run((ctx) =>
      issueRevokedPosTerminalReconnectIntent(ctx as never, {
        browserFingerprintHash: "fingerprint-a",
        correlationId: "corr-intent-2",
        currentProofHash: "proof-a-1",
        intentTokenHash: "intent-hash-2",
        now: 203,
        terminalId: seeded.terminalAId,
      }),
    );
    await t.run((ctx) =>
      issueRevokedPosTerminalReconnectIntent(ctx as never, {
        browserFingerprintHash: "fingerprint-a",
        correlationId: "corr-intent-3",
        currentProofHash: "proof-a-1",
        intentTokenHash: "intent-hash-3",
        now: 204,
        terminalId: seeded.terminalAId,
      }),
    );
    await expect(
      t.run((ctx) =>
        issueRevokedPosTerminalReconnectIntent(ctx as never, {
          browserFingerprintHash: "fingerprint-a",
          correlationId: "corr-intent-4",
          currentProofHash: "proof-a-1",
          intentTokenHash: "intent-hash-4",
          now: 205,
          terminalId: seeded.terminalAId,
        }),
      ),
    ).rejects.toThrow("reconnect_intent_rate_limited");

    expect(first.expiresAt).toBe(5 * 60 * 1_000 + 202);
    expect(second.terminalId).toBe(seeded.terminalAId);
    const intents = await t.run((ctx) =>
      ctx.db
        .query("posTerminalReconnectIntent")
        .withIndex("by_terminalId_and_issuedAt", (query) =>
          query.eq("terminalId", seeded.terminalAId),
        )
        .take(4),
    );
    expect(intents).toHaveLength(3);
    expect(intents.map(({ status }) => status)).toEqual([
      "revoked",
      "revoked",
      "pending",
    ]);
  });

  it("resolves only live same-browser intent evidence", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTerminals(t);
    await t.run((ctx) =>
      disconnectPosTerminal(ctx as never, {
        correlationId: "corr-disconnect-resolve",
        disconnectedByUserId: seeded.adminId,
        now: 200,
        storeId: seeded.storeAId,
        terminalId: seeded.terminalAId,
      }),
    );
    await t.run((ctx) =>
      issueRevokedPosTerminalReconnectIntent(ctx as never, {
        browserFingerprintHash: "fingerprint-a",
        correlationId: "corr-intent-resolve",
        currentProofHash: "proof-a-1",
        intentTokenHash: "intent-hash-resolve",
        now: 201,
        terminalId: seeded.terminalAId,
      }),
    );

    await expect(
      t.run((ctx) =>
        resolvePosTerminalReconnectIntent(ctx as never, {
          browserFingerprintHash: "fingerprint-b",
          intentTokenHash: "intent-hash-resolve",
          now: 202,
        }),
      ),
    ).rejects.toThrow("reconnect_intent_invalid");
    await expect(
      t.run((ctx) =>
        resolvePosTerminalReconnectIntent(ctx as never, {
          browserFingerprintHash: "fingerprint-a",
          intentTokenHash: "intent-hash-resolve",
          now: 5 * 60 * 1_000 + 201,
        }),
      ),
    ).rejects.toThrow("reconnect_intent_invalid");
    await expect(
      t.run((ctx) =>
        resolvePosTerminalReconnectIntent(ctx as never, {
          browserFingerprintHash: "fingerprint-a",
          intentTokenHash: "intent-hash-resolve",
          now: 202,
        }),
      ),
    ).resolves.toMatchObject({
      intent: { terminalId: seeded.terminalAId },
      terminal: { _id: seeded.terminalAId, status: "revoked" },
    });
  });

  it("reassigns one active terminal row across same-organization stores with current proof", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedTerminals(t);

    const reassigned = await t.run((ctx) =>
      reassignPosTerminal(ctx as never, {
        correlationId: "corr-reassign",
        currentProofHash: "proof-a-1",
        fingerprintHash: "fingerprint-a",
        nextProofHash: "proof-a-2",
        now: 150,
        organizationId: seeded.organizationId,
        sourceStoreId: seeded.storeAId,
        targetStoreId: seeded.storeBId,
        terminalId: seeded.terminalAId,
        reassignedByUserId: seeded.adminId,
      }),
    );

    expect(reassigned).toMatchObject({
      terminalId: seeded.terminalAId,
      storeId: seeded.storeBId,
      lifecycleRevision: 2,
      proofRevision: 2,
    });
    expect(
      await t.run((ctx) => ctx.db.get("posTerminal", seeded.terminalAId)),
    ).toMatchObject({
      _id: seeded.terminalAId,
      storeId: seeded.storeBId,
      fingerprintHash: "fingerprint-a",
      syncSecretHash: "proof-a-2",
    });
  });
});

async function seedTerminals(
  t: ReturnType<typeof convexTest>,
  options: { withBindings?: boolean } = {},
) {
  return t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organization", { name: "Org" });
    const storeAId = await ctx.db.insert("store", {
      name: "Store A",
      organizationId,
    });
    const storeBId = await ctx.db.insert("store", {
      name: "Store B",
      organizationId,
    });
    const adminId = await ctx.db.insert("athenaUser", { email: "admin@example.com" });
    const terminalAId = await ctx.db.insert("posTerminal", {
      organizationId,
      storeId: storeAId,
      fingerprintHash: "fingerprint-a",
      syncSecretHash: "proof-a-1",
      displayName: "Front register",
      registeredByUserId: adminId,
      browserInfo: { userAgent: "test-a" },
      registeredAt: 1,
      status: "active",
      lifecycleRevision: 1,
      proofRevision: 1,
      lastCorrelationId: "corr-terminal-a",
    });
    const terminalBId = await ctx.db.insert("posTerminal", {
      organizationId,
      storeId: storeAId,
      fingerprintHash: "fingerprint-b",
      syncSecretHash: "proof-b-1",
      displayName: "Back register",
      registeredByUserId: adminId,
      browserInfo: { userAgent: "test-b" },
      registeredAt: 1,
      status: "active",
      lifecycleRevision: 1,
      proofRevision: 1,
      lastCorrelationId: "corr-terminal-b",
    });
    if (!options.withBindings) {
      return { organizationId, storeAId, storeBId, adminId, terminalAId, terminalBId };
    }
    const authUserId = await ctx.db.insert("users", {});
    const principalId = await ctx.db.insert("servicePrincipal", {
      organizationId,
      storeId: storeAId,
      stableKey: "store.service",
      status: "active",
      lifecycleRevision: 1,
      createdAt: 1,
      updatedAt: 1,
      lastCorrelationId: "corr-principal",
    });
    const grantId = await ctx.db.insert("servicePrincipalCapability", {
      organizationId,
      storeId: storeAId,
      servicePrincipalId: principalId,
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
      storeId: storeAId,
      servicePrincipalId: principalId,
      authUserId,
      status: "active",
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      lastCorrelationId: "corr-auth-binding",
    });
    const credentialId = await ctx.db.insert("posRecoveryCredential", {
      storeId: storeAId,
    });
    async function binding(terminalId: typeof terminalAId, authSuffix: string) {
      const authSessionId = await ctx.db.insert("authSessions", {
        expirationTime: 1_000,
        userId: authUserId,
      });
      const serviceSessionId = await ctx.db.insert("servicePrincipalSession", {
        organizationId,
        storeId: storeAId,
        servicePrincipalId: principalId,
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
        lastCorrelationId: `corr-session-${authSuffix}`,
      });
      return ctx.db.insert("posApplicationSessionBinding", {
        organizationId,
        storeId: storeAId,
        servicePrincipalId: principalId,
        servicePrincipalSessionId: serviceSessionId,
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
        lastCorrelationId: `corr-binding-${authSuffix}`,
      });
    }
    const bindingAId = await binding(terminalAId, "a");
    // Deliberately model the sibling binding in the same principal/store authority;
    // its terminal row remains untouched by disconnecting terminal A.
    const bindingBId = await binding(terminalBId, "b");
    return {
      organizationId,
      storeAId,
      storeBId,
      adminId,
      terminalAId,
      terminalBId,
      principalId,
      grantId,
      bindingAId,
      bindingBId,
    };
  });
}

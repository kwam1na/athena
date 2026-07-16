/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  posApplicationSessionBindingSchema,
  posRecoveryCredentialSchema,
  posServicePrincipalMigrationCandidateSchema,
  posServicePrincipalMigrationRunSchema,
  posServicePrincipalMigrationStoreStateSchema,
  posServicePrincipalMigrationTerminalEvidenceSchema,
  posTerminalSchema,
} from "../schemas/pos";
import { servicePrincipalTables } from "../schemas/servicePrincipals";
import {
  backfillStoreServicePrincipalsBatchWithCtx,
  buildPosServicePrincipalCredentialCensusState,
  evaluatePosGlobalRetirement,
  evaluatePosMigrationRollback,
  resolvePosMigrationAuthority,
  transitionPosServicePrincipalMigrationModeWithCtx,
} from "./backfillStoreServicePrincipals";
import { recordPosTerminalMigrationRecoveryWithCtx } from "../pos/application/posServicePrincipalMigrationEvidence";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.replace(/^\.\.\//, "./"),
    loader,
  ]),
);

const schema = defineSchema({
  organization: defineTable(v.object({ name: v.string() })),
  store: defineTable(
    v.object({ name: v.string(), organizationId: v.id("organization") }),
  ),
  athenaUser: defineTable(
    v.object({ email: v.string(), normalizedEmail: v.optional(v.string()) }),
  ).index("by_normalizedEmail", ["normalizedEmail"]),
  users: defineTable(v.object({ email: v.optional(v.string()) })),
  authSessions: defineTable(v.any()),
  organizationMember: defineTable(
    v.object({
      organizationId: v.id("organization"),
      role: v.union(v.literal("full_admin"), v.literal("pos_only")),
      userId: v.id("athenaUser"),
    }),
  ).index("by_organizationId_userId", ["organizationId", "userId"]),
  posRecoveryCredential: defineTable(posRecoveryCredentialSchema).index(
    "by_storeId",
    ["storeId"],
  ),
  posApplicationSessionBinding: defineTable(posApplicationSessionBindingSchema)
    .index("by_servicePrincipalSessionId", ["servicePrincipalSessionId"])
    .index("by_terminalId_and_status", ["terminalId", "status"]),
  posTerminal: defineTable(posTerminalSchema)
    .index("by_storeId", ["storeId"])
    .index("by_fingerprintHash", ["fingerprintHash"]),
  posServicePrincipalMigrationRun: defineTable(
    posServicePrincipalMigrationRunSchema,
  ),
  posServicePrincipalMigrationCandidate: defineTable(
    posServicePrincipalMigrationCandidateSchema,
  ).index("by_runId_storeId", ["runId", "storeId"]),
  posServicePrincipalMigrationStoreState: defineTable(
    posServicePrincipalMigrationStoreStateSchema,
  ).index("by_storeId", ["storeId"]),
  posServicePrincipalMigrationTerminalEvidence: defineTable(
    posServicePrincipalMigrationTerminalEvidenceSchema,
  ).index("by_storeId_terminalId", ["storeId", "terminalId"]),
  ...servicePrincipalTables,
});

async function seedLegacyStore(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  options: {
    authUserId?: Id<"users">;
    plaintext?: string;
    posAccountId?: Id<"athenaUser">;
    terminalFingerprint?: string;
  } = {},
) {
  return t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organization", {
      name: `Organization ${suffix}`,
    });
    const storeId = await ctx.db.insert("store", {
      name: `Store ${suffix}`,
      organizationId,
    });
    const posAccountId =
      options.posAccountId ??
      (await ctx.db.insert("athenaUser", {
        email: "pos@wigclub.store",
        normalizedEmail: "pos@wigclub.store",
      }));
    const authUserId =
      options.authUserId ??
      (await ctx.db.insert("users", {
        email: "pos@wigclub.store",
      }));
    await ctx.db.insert("organizationMember", {
      organizationId,
      role: "pos_only",
      userId: posAccountId,
    });
    const credentialId = await ctx.db.insert("posRecoveryCredential", {
      codeHash: "legacy-hash",
      codeSalt: "legacy-salt",
      codeVersion: 1,
      createdAt: 1,
      failedAttemptCount: 0,
      organizationId,
      ...(options.plaintext === undefined
        ? {}
        : { plaintextCode: options.plaintext }),
      posAccountId,
      rotatedAt: 1,
      status: "active",
      storeId,
      verifierKind: "legacy_sha256",
    });
    const terminalId = await ctx.db.insert("posTerminal", {
      browserInfo: { userAgent: "test" },
      displayName: `Terminal ${suffix}`,
      fingerprintHash: options.terminalFingerprint ?? `fingerprint-${suffix}`,
      lifecycleRevision: 3,
      proofRevision: 5,
      registeredAt: 1,
      registeredByUserId: posAccountId,
      status: "active",
      storeId,
      syncSecretHash: `proof-${suffix}`,
    });
    return {
      authUserId,
      credentialId,
      organizationId,
      posAccountId,
      storeId,
      terminalId,
    };
  });
}

async function finishRun(
  t: ReturnType<typeof convexTest>,
  input: {
    dryRun: boolean;
    previewRunId?: Id<"posServicePrincipalMigrationRun">;
  },
) {
  let cursor: string | null = null;
  let runId: Id<"posServicePrincipalMigrationRun"> | undefined;
  const candidates: Array<{
    action: string;
    conflicts: string[];
    storeId: Id<"store">;
  }> = [];
  while (true) {
    const result = await t.run((ctx) =>
      backfillStoreServicePrincipalsBatchWithCtx(
        ctx as never,
        {
          automationIdentity: "deploy:v26-1078",
          cursor,
          dryRun: input.dryRun,
          limit: 1,
          previewRunId: input.previewRunId,
          runId,
        },
        {
          migrateCredential: (async (
            migrationCtx: MutationCtx,
            args: {
              credentialId: Id<"posRecoveryCredential">;
              now: number;
            },
          ) => {
            const credential = await migrationCtx.db.get(
              "posRecoveryCredential",
              args.credentialId,
            );
            if (!credential) return { disposition: "missing" as const };
            if (!credential.plaintextCode) {
              await migrationCtx.db.patch(
                "posRecoveryCredential",
                credential._id,
                {
                  legacyMigrationAt: args.now,
                  legacyMigrationStatus: "rotation_required",
                  rotationRequiredAt: args.now,
                },
              );
              return { disposition: "rotation_required" as const };
            }
            await migrationCtx.db.patch(
              "posRecoveryCredential",
              credential._id,
              {
                codeHash: undefined,
                codeSalt: undefined,
                codeVersion: undefined,
                credentialRevision: (credential.credentialRevision ?? 1) + 1,
                keyedVerifierDigest: "keyed-digest",
                keyedVerifierIterations: 600_000,
                keyedVerifierPepperVersion: 1,
                keyedVerifierSalt: "keyed-salt",
                keyedVerifierVersion: 1,
                legacyMigrationAt: args.now,
                legacyMigrationStatus: "migrated",
                plaintextCode: undefined,
                plaintextRemovedAt: args.now,
                verifierKind: "deployment_keyed_pbkdf2_sha256",
              },
            );
            return { disposition: "migrated" as const };
          }) as never,
        },
      ),
    );
    runId = result.runId;
    candidates.push(...result.candidates);
    if (result.isDone) return { ...result, candidates, runId };
    cursor = result.continueCursor;
  }
}

describe("store service-principal migration controls", () => {
  it("previews and idempotently applies the bounded widening without changing terminal lineage", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedLegacyStore(t, "A", { plaintext: "anchor42" });

    const preview = await finishRun(t, { dryRun: true });
    expect(preview.status).toBe("completed");
    expect(preview.candidates).toEqual([
      expect.objectContaining({
        action: "reconcile",
        conflicts: expect.arrayContaining([
          "principal_missing",
          "credential_legacy_sha_only",
          "credential_plaintext_exposed",
          "terminal_recovery_pending",
        ]),
        storeId: seeded.storeId,
      }),
    ]);

    const beforeTerminal = await t.run((ctx) =>
      ctx.db.get("posTerminal", seeded.terminalId),
    );
    const apply = await finishRun(t, {
      dryRun: false,
      previewRunId: preview.runId,
    });
    expect(apply.status).toBe("completed");
    expect(apply.changedCount).toBe(1);

    const state = await t.run(async (ctx) => ({
      bindings: await ctx.db.query("servicePrincipalAuthBinding").take(10),
      credentials: await ctx.db.query("posRecoveryCredential").take(10),
      evidence: await ctx.db
        .query("posServicePrincipalMigrationTerminalEvidence")
        .take(10),
      grants: await ctx.db.query("servicePrincipalCapability").take(10),
      principals: await ctx.db.query("servicePrincipal").take(10),
      storeStates: await ctx.db
        .query("posServicePrincipalMigrationStoreState")
        .take(10),
      terminal: await ctx.db.get("posTerminal", seeded.terminalId),
      users: await ctx.db.query("users").take(10),
    }));
    expect(state.principals).toHaveLength(1);
    expect(state.grants).toHaveLength(1);
    expect(state.bindings).toHaveLength(1);
    expect(state.bindings[0].authUserId).not.toBe(seeded.authUserId);
    expect(state.users).toHaveLength(2);
    expect(
      state.users.find((user) => user._id === state.bindings[0].authUserId),
    ).not.toHaveProperty("email");
    expect(state.credentials[0]).toMatchObject({
      legacyMigrationStatus: "migrated",
      servicePrincipalId: state.principals[0]._id,
      verifierKind: "deployment_keyed_pbkdf2_sha256",
    });
    expect(state.credentials[0]).not.toHaveProperty("plaintextCode");
    expect(state.storeStates[0]).toMatchObject({
      legacyFallbackAllowed: true,
      mode: "compatibility",
    });
    expect(state.evidence[0]).toMatchObject({
      status: "pending",
      terminalId: seeded.terminalId,
      terminalLifecycleRevision: 3,
      terminalProofRevision: 5,
    });
    expect(state.terminal).toEqual(beforeTerminal);

    const retried = await finishRun(t, {
      dryRun: false,
      previewRunId: preview.runId,
    });
    expect(retried.changedCount).toBe(0);
    expect(
      await t.run((ctx) => ctx.db.query("servicePrincipal").take(10)),
    ).toHaveLength(1);

    const freshPreview = await finishRun(t, { dryRun: true });
    await finishRun(t, {
      dryRun: false,
      previewRunId: freshPreview.runId,
    });
    expect(await t.run((ctx) => ctx.db.query("users").take(10))).toHaveLength(
      2,
    );
  });

  it("blocks a transport binding that reuses the legacy synthetic Auth user", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedLegacyStore(t, "A", { plaintext: "anchor42" });
    const preview = await finishRun(t, { dryRun: true });
    await finishRun(t, { dryRun: false, previewRunId: preview.runId });
    await t.run(async (ctx) => {
      const binding = (
        await ctx.db.query("servicePrincipalAuthBinding").take(1)
      )[0];
      await ctx.db.patch("servicePrincipalAuthBinding", binding._id, {
        authUserId: seeded.authUserId,
      });
    });

    const invalidPreview = await finishRun(t, { dryRun: true });
    expect(invalidPreview.status).toBe("blocked");
    expect(invalidPreview.candidates[0]).toEqual(
      expect.objectContaining({
        action: "conflict",
        conflicts: expect.arrayContaining([
          "transport_auth_user_not_neutral",
          "transport_binding_legacy_identity",
        ]),
      }),
    );
  });

  it("refuses a stale preview before changing the candidate store", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedLegacyStore(t, "A", { plaintext: "anchor42" });
    const preview = await finishRun(t, { dryRun: true });

    await t.run((ctx) =>
      ctx.db.patch("posTerminal", seeded.terminalId, { proofRevision: 6 }),
    );
    await expect(
      finishRun(t, { dryRun: false, previewRunId: preview.runId }),
    ).rejects.toThrow("Migration preview is stale");
    expect(
      await t.run((ctx) => ctx.db.query("servicePrincipal").take(10)),
    ).toHaveLength(0);
  });

  it("fingerprints safe credential state without retaining plaintext distinctions", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedLegacyStore(t, "A", { plaintext: "anchor42" });
    const credential = await t.run((ctx) =>
      ctx.db.get("posRecoveryCredential", seeded.credentialId),
    );
    expect(credential).not.toBeNull();

    const anchor = buildPosServicePrincipalCredentialCensusState(credential!);
    const beacon = buildPosServicePrincipalCredentialCensusState({
      ...credential!,
      plaintextCode: "beacon42",
    });
    const rotated = buildPosServicePrincipalCredentialCensusState({
      ...credential!,
      credentialRevision: (credential!.credentialRevision ?? 1) + 1,
      plaintextCode: "beacon42",
      rotatedAt: 2,
    });

    expect(anchor).toEqual(beacon);
    expect(rotated).not.toEqual(anchor);
    expect(JSON.stringify(anchor)).not.toContain("anchor42");
  });

  it("blocks structural conflicts while preserving human POS-only membership census", async () => {
    const t = convexTest(schema, modules);
    const storeA = await seedLegacyStore(t, "A", {
      plaintext: "anchor42",
      terminalFingerprint: "collision",
    });
    const storeB = await seedLegacyStore(t, "B", {
      authUserId: storeA.authUserId,
      plaintext: "beacon42",
      posAccountId: storeA.posAccountId,
      terminalFingerprint: "collision",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("posRecoveryCredential", {
        codeHash: "duplicate",
        codeSalt: "salt",
        codeVersion: 1,
        createdAt: 1,
        failedAttemptCount: 0,
        organizationId: storeA.organizationId,
        posAccountId: storeA.posAccountId,
        rotatedAt: 1,
        status: "active",
        storeId: storeA.storeId,
      });
      const humanId = await ctx.db.insert("athenaUser", {
        email: "human@example.com",
        normalizedEmail: "human@example.com",
      });
      await ctx.db.insert("organizationMember", {
        organizationId: storeA.organizationId,
        role: "pos_only",
        userId: humanId,
      });
    });

    const preview = await finishRun(t, { dryRun: true });
    expect(preview.status).toBe("blocked");
    expect(preview.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "conflict",
          conflicts: expect.arrayContaining([
            "credential_duplicate",
            "terminal_cross_store_binding",
          ]),
          storeId: storeA.storeId,
        }),
        expect.objectContaining({
          action: "conflict",
          storeId: storeB.storeId,
        }),
      ]),
    );
    const candidate = await t.run((ctx) =>
      ctx.db
        .query("posServicePrincipalMigrationCandidate")
        .withIndex("by_runId_storeId", (query) =>
          query.eq("runId", preview.runId).eq("storeId", storeA.storeId),
        )
        .unique(),
    );
    expect(candidate?.humanPosOnlyMembershipCount).toBe(1);
  });

  it("marks missing legacy plaintext for full-admin rotation without inventing a code", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedLegacyStore(t, "A");
    const preview = await finishRun(t, { dryRun: true });
    expect(preview.candidates[0].action).toBe("rotation_required");

    await finishRun(t, { dryRun: false, previewRunId: preview.runId });
    const credential = await t.run((ctx) =>
      ctx.db.get("posRecoveryCredential", seeded.credentialId),
    );
    expect(credential).toMatchObject({
      legacyMigrationStatus: "rotation_required",
      servicePrincipalId: expect.any(String),
    });
    expect(credential).not.toHaveProperty("plaintextCode");
  });

  it("records terminal-specific successful recovery without changing terminal identity or proof", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedLegacyStore(t, "A", { plaintext: "anchor42" });
    const preview = await finishRun(t, { dryRun: true });
    await finishRun(t, { dryRun: false, previewRunId: preview.runId });
    const principal = (
      await t.run((ctx) => ctx.db.query("servicePrincipal").take(1))
    )[0];
    const before = await t.run((ctx) =>
      ctx.db.get("posTerminal", seeded.terminalId),
    );
    const { posApplicationSessionBindingId, servicePrincipalSessionId } =
      await t.run(async (ctx) => {
        const binding = (
          await ctx.db.query("servicePrincipalAuthBinding").take(1)
        )[0];
        const grant = (
          await ctx.db.query("servicePrincipalCapability").take(1)
        )[0];
        const authSessionId = await ctx.db.insert("authSessions", {});
        const servicePrincipalSessionId = await ctx.db.insert(
          "servicePrincipalSession",
          {
            absoluteExpiresAt: 10_000,
            authSessionId,
            authUserId: binding.authUserId,
            capabilityRevision: grant.revision,
            consumerId: "pos",
            idleExpiresAt: 5_000,
            issuedAt: 100,
            lastCorrelationId: "recovery-test",
            lastSeenAt: 100,
            organizationId: seeded.organizationId,
            principalLifecycleRevision: principal.lifecycleRevision,
            requiredCapabilityId: "pos.application",
            revision: 1,
            servicePrincipalAuthBindingId: binding._id,
            servicePrincipalId: principal._id,
            status: "active",
            storeId: seeded.storeId,
            updatedAt: 100,
          },
        );
        const posApplicationSessionBindingId = await ctx.db.insert(
          "posApplicationSessionBinding",
          {
            activatedAt: 100,
            capabilityGrantId: grant._id,
            capabilityId: "pos.application",
            capabilityRevision: grant.revision,
            consumerId: "pos",
            credentialRevision: 2,
            lastCorrelationId: "recovery-test",
            offlineAuthorityReceipt: "signed-receipt",
            organizationId: seeded.organizationId,
            posRecoveryCredentialId: seeded.credentialId,
            principalLifecycleRevision: principal.lifecycleRevision,
            revision: 1,
            servicePrincipalId: principal._id,
            servicePrincipalSessionId,
            status: "active",
            storeId: seeded.storeId,
            terminalId: seeded.terminalId,
            terminalLifecycleRevision: 3,
            terminalProofRevision: 5,
            updatedAt: 100,
          },
        );
        await ctx.db.patch("posTerminal", seeded.terminalId, {
          lastServicePrincipalRecoveryAt: 100,
          servicePrincipalRecoveryVersion: 1,
        });
        return { posApplicationSessionBindingId, servicePrincipalSessionId };
      });

    const evidence = await t.run((ctx) =>
      recordPosTerminalMigrationRecoveryWithCtx(ctx as never, {
        credentialId: seeded.credentialId,
        credentialRevision: 2,
        now: 500,
        organizationId: seeded.organizationId,
        posApplicationSessionBindingId,
        recoveryVersion: 1,
        servicePrincipalId: principal._id,
        servicePrincipalSessionId,
        storeId: seeded.storeId,
        terminalId: seeded.terminalId,
      }),
    );
    expect(evidence).toMatchObject({
      credentialRevision: 2,
      recoveryVersion: 1,
      status: "recovered",
      successfulRecoveryAt: 500,
    });
    expect(
      await t.run((ctx) => ctx.db.get("posTerminal", seeded.terminalId)),
    ).toEqual({
      ...before,
      lastServicePrincipalRecoveryAt: 100,
      servicePrincipalRecoveryVersion: 1,
    });

    const shadow = await t.run((ctx) =>
      transitionPosServicePrincipalMigrationModeWithCtx(ctx as never, {
        expectedRevision: 1,
        nextMode: "shadow",
        now: 600,
        rollbackDeadlineAt: 1_000,
        storeId: seeded.storeId,
      }),
    );
    expect(shadow).toMatchObject({
      legacyFallbackAllowed: true,
      mode: "shadow",
      revision: 2,
    });
    const enforced = await t.run((ctx) =>
      transitionPosServicePrincipalMigrationModeWithCtx(ctx as never, {
        expectedRevision: 2,
        nextMode: "enforced",
        now: 700,
        storeId: seeded.storeId,
      }),
    );
    expect(enforced).toMatchObject({
      legacyFallbackAllowed: false,
      mode: "enforced",
      revision: 3,
    });
  });
});

describe("migration compatibility and retirement controls", () => {
  it("never attempts legacy fallback for an enforced store", () => {
    expect(
      resolvePosMigrationAuthority({
        legacyAuthorityValid: true,
        mode: "enforced",
        newAuthorityValid: false,
      }),
    ).toEqual({
      authorization: "denied",
      legacyFallbackAttempted: false,
      shadowResult: null,
    });
  });

  it("allows rollback only before retirement and the recorded deadline", () => {
    expect(
      evaluatePosMigrationRollback({ now: 99, rollbackDeadlineAt: 100 }),
    ).toEqual({ allowed: true, reason: null });
    expect(
      evaluatePosMigrationRollback({ now: 101, rollbackDeadlineAt: 100 }),
    ).toEqual({ allowed: false, reason: "rollback_deadline_passed" });
    expect(
      evaluatePosMigrationRollback({
        globalRetiredAt: 90,
        now: 99,
        rollbackDeadlineAt: 100,
      }),
    ).toEqual({ allowed: false, reason: "global_authority_retired" });
  });

  it("requires complete fleet evidence and a closed rollback window before retirement", () => {
    expect(
      evaluatePosGlobalRetirement({
        activeStoreCount: 2,
        conflictedStoreCount: 0,
        enforcedStoreCount: 1,
        latestRollbackDeadlineAt: 100,
        now: 90,
        pendingTerminalCount: 1,
        plaintextCredentialCount: 1,
        rotationRequiredCredentialCount: 1,
      }),
    ).toEqual({
      allowed: false,
      blockers: [
        "stores_not_enforced",
        "terminals_not_recovered",
        "plaintext_credentials_present",
        "credential_rotation_required",
        "rollback_window_open",
      ],
    });
    expect(
      evaluatePosGlobalRetirement({
        activeStoreCount: 2,
        conflictedStoreCount: 0,
        enforcedStoreCount: 2,
        latestRollbackDeadlineAt: 100,
        now: 101,
        pendingTerminalCount: 0,
        plaintextCredentialCount: 0,
        rotationRequiredCredentialCount: 0,
      }),
    ).toEqual({ allowed: true, blockers: [] });
  });
});

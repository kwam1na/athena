import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Id } from "../../_generated/dataModel";
import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";

const authServerMocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: authServerMocks.getAuthUserId,
}));

import {
  createOrRotateRecoveryCodeForTest,
  getRecoveryCodeStatus,
  hashPosRecoveryCode,
  migrateLegacyRecoveryCredentialWithCtx,
  prepareRecoveryForAuthProviderWithCtx,
  requestPosTerminalRecoveryDisposition,
  requestPosTerminalRecoveryDispositionWithCtx,
  revokeRecoveryCode,
  rotateRecoveryCode,
  unlockRecoveryCode,
  verifyRecoveryCodeForAuthProvider,
} from "./posRecoveryCodes";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

const STORE_ID = "store-1" as Id<"store">;
const ORG_ID = "org-1" as Id<"organization">;
const POS_ACCOUNT_ID = "athena-pos-account-1" as Id<"athenaUser">;
const AUTH_USER_ID = "auth-user-pos" as Id<"users">;
const FULL_ADMIN_ID = "athena-full-admin-1" as Id<"athenaUser">;
const FULL_ADMIN_AUTH_USER_ID = "auth-user-full-admin" as Id<"users">;
const RECOVERY_CODE_PATTERN = /^[a-z]+\d{2}$/;

describe("POS recovery codes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.POS_RECOVERY_CODE_ACTIVE_PEPPER_VERSION = "2";
    process.env.POS_RECOVERY_CODE_PEPPERS_JSON = JSON.stringify({
      1: "previous-pepper-material-0000000000000001",
      2: "current-pepper-material-00000000000000002",
    });
    authServerMocks.getAuthUserId.mockResolvedValue(null);
    let byte = 0;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          for (let index = 0; index < bytes.length; index += 1) {
            byte = (byte + 1) % 255;
            bytes[index] = byte;
          }
          return bytes;
        },
        subtle: {
          digest: vi.fn(async (_algorithm: string, data: ArrayBuffer) => {
            const source = Array.from(new Uint8Array(data));
            const output = new Uint8Array(32);
            source.forEach((value, index) => {
              output[index % output.length] ^= value;
            });
            return output.buffer;
          }),
          importKey: vi.fn(async (_format, material) => material),
          deriveBits: vi.fn(async (algorithm, material) => {
            const source = [
              ...new Uint8Array(material as ArrayBuffer),
              ...new Uint8Array(algorithm.salt as ArrayBuffer),
              algorithm.iterations % 251,
            ];
            const output = new Uint8Array(32);
            source.forEach((value, index) => {
              output[index % output.length] ^= value;
            });
            return output.buffer;
          }),
        },
      },
    });
  });

  it("defines indexes for recovery store and membership lookups", () => {
    const schemaSource = readFileSync(
      join(process.cwd(), "convex", "schema.ts"),
      "utf8",
    );

    expect(schemaSource).toContain(
      'organization: defineTable(organizationSchema).index("by_slug", ["slug"])',
    );
    expect(schemaSource).toContain(
      '.index("by_organizationId_slug", ["organizationId", "slug"])',
    );
    expect(schemaSource).toContain(
      '.index("by_organizationId_userId", ["organizationId", "userId"])',
    );
  });

  it("returns the recovery-code lane for exact active terminal evidence", async () => {
    const ctx = buildCtx();
    const terminalProof = "terminal-proof-1";
    ctx.tables.posTerminal.push({
      _id: "terminal-1",
      organizationId: ORG_ID,
      storeId: STORE_ID,
      status: "active",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: await hashPosTerminalSyncSecret(terminalProof),
      lifecycleRevision: 1,
      proofRevision: 1,
    });

    const result = await getHandler(requestPosTerminalRecoveryDisposition)(
      ctx,
      {
        browserFingerprintHash: "fingerprint-1",
        terminalId: "terminal-1",
        terminalProof,
      },
    );

    assertConformsToExportedReturns(
      requestPosTerminalRecoveryDisposition,
      result,
    );
    expect(result).toEqual({ disposition: "recovery_code_required" });
    expect(ctx.tables.posRecoveryCredential).toHaveLength(0);
    expect(ctx.tables.posTerminalReconnectIntent).toHaveLength(0);
    expect(ctx.tables.posRecoveryExchange).toHaveLength(0);
    expect(ctx.tables.authSessions).toHaveLength(0);
  });

  it("issues an opaque audited reconnect intent before touching recovery credentials", async () => {
    const ctx = buildCtx();
    const terminalProof = "terminal-proof-1";
    const credential = {
      _id: "credential-untouched",
      failedAttemptCount: 4,
      storeId: STORE_ID,
    };
    ctx.tables.posRecoveryCredential.push(credential);
    ctx.tables.posTerminal.push({
      _id: "terminal-1",
      organizationId: ORG_ID,
      storeId: STORE_ID,
      status: "revoked",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: await hashPosTerminalSyncSecret(terminalProof),
      lifecycleRevision: 2,
      proofRevision: 2,
    });

    const result = await requestPosTerminalRecoveryDispositionWithCtx(
      ctx as never,
      {
        browserFingerprintHash: "fingerprint-1",
        terminalId: "terminal-1" as never,
        terminalProof,
      },
      { now: 1_000 },
    );

    assertConformsToExportedReturns(
      requestPosTerminalRecoveryDisposition,
      result,
    );
    expect(result).toMatchObject({
      disposition: "administrator_reconnect_required",
      reconnectIntentToken: expect.stringMatching(/^[a-f0-9]{64}$/),
      expiresAt: 5 * 60 * 1_000 + 1_000,
    });
    expect(ctx.tables.posTerminalReconnectIntent).toHaveLength(1);
    expect(ctx.tables.posTerminalReconnectIntent[0]).toEqual(
      expect.objectContaining({
        browserFingerprintHash: "fingerprint-1",
        status: "pending",
        terminalId: "terminal-1",
        terminalLifecycleRevision: 2,
        terminalProofRevision: 2,
      }),
    );
    expect(ctx.tables.posTerminalReconnectIntent[0].intentTokenHash).not.toBe(
      result.disposition === "administrator_reconnect_required"
        ? result.reconnectIntentToken
        : "",
    );
    expect(credential).toEqual({
      _id: "credential-untouched",
      failedAttemptCount: 4,
      storeId: STORE_ID,
    });
    expect(ctx.tables.posRecoveryExchange).toHaveLength(0);
    expect(ctx.tables.authSessions).toHaveLength(0);
    expect(ctx.tables.operationalEvent).toEqual([
      expect.objectContaining({
        eventType: "pos_terminal_reconnect_intent_issued",
        reason: "administrator_reconnect_required",
        terminalId: "terminal-1",
      }),
    ]);
    expect(JSON.stringify(ctx.tables)).not.toContain(
      result.disposition === "administrator_reconnect_required"
        ? result.reconnectIntentToken
        : "unexpected",
    );
  });

  it("keeps wrong or missing revoked-terminal proof and browser evidence generic and no-change", async () => {
    const ctx = buildCtx();
    const terminalProof = "terminal-proof-1";
    ctx.tables.posRecoveryCredential.push({
      _id: "credential-untouched",
      failedAttemptCount: 2,
      storeId: STORE_ID,
    });
    ctx.tables.posTerminal.push({
      _id: "terminal-1",
      organizationId: ORG_ID,
      storeId: STORE_ID,
      status: "revoked",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: await hashPosTerminalSyncSecret(terminalProof),
      lifecycleRevision: 2,
      proofRevision: 2,
    });

    for (const evidence of [
      { browserFingerprintHash: "fingerprint-2", terminalProof },
      { browserFingerprintHash: "fingerprint-1", terminalProof: "wrong-proof" },
      { browserFingerprintHash: "fingerprint-1", terminalProof: "" },
    ]) {
      await expect(
        requestPosTerminalRecoveryDispositionWithCtx(
          ctx as never,
          { ...evidence, terminalId: "terminal-1" as never },
          { now: 1_000 },
        ),
      ).rejects.toThrow("POS recovery sign-in failed.");
    }
    expect(ctx.tables.posRecoveryCredential[0].failedAttemptCount).toBe(2);
    expect(ctx.tables.posTerminalReconnectIntent).toHaveLength(0);
    expect(ctx.tables.posRecoveryExchange).toHaveLength(0);
    expect(ctx.tables.authSessions).toHaveLength(0);
  });

  it("rate-limits and audits repeated valid reconnect-intent issuance without credential changes", async () => {
    const ctx = buildCtx();
    const terminalProof = "terminal-proof-1";
    const credential = {
      _id: "credential-untouched",
      failedAttemptCount: 3,
      storeId: STORE_ID,
    };
    ctx.tables.posRecoveryCredential.push(credential);
    ctx.tables.posTerminal.push({
      _id: "terminal-1",
      organizationId: ORG_ID,
      storeId: STORE_ID,
      status: "revoked",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: await hashPosTerminalSyncSecret(terminalProof),
      lifecycleRevision: 2,
      proofRevision: 2,
    });
    const args = {
      browserFingerprintHash: "fingerprint-1",
      terminalId: "terminal-1" as never,
      terminalProof,
    };

    for (const now of [1_000, 1_001, 1_002]) {
      await expect(
        requestPosTerminalRecoveryDispositionWithCtx(ctx as never, args, {
          now,
        }),
      ).resolves.toMatchObject({
        disposition: "administrator_reconnect_required",
      });
    }
    await expect(
      requestPosTerminalRecoveryDispositionWithCtx(ctx as never, args, {
        now: 1_003,
      }),
    ).rejects.toThrow("POS recovery sign-in failed.");

    expect(credential.failedAttemptCount).toBe(3);
    expect(ctx.tables.posTerminalReconnectIntent).toHaveLength(3);
    expect(ctx.tables.operationalEvent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "pos_terminal_reconnect_intent_rate_limited",
          reason: "rate_limited",
        }),
      ]),
    );
  });

  it("creates a deployment-keyed credential, reveals its code once, and verifies it", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);

    const created = await create(ctx, { storeId: STORE_ID });

    expect(created.code).toMatch(RECOVERY_CODE_PATTERN);
    expect(ctx.tables.posRecoveryCredential).toHaveLength(1);
    const credential = ctx.tables.posRecoveryCredential[0];
    expect(credential).toEqual(
      expect.objectContaining({
        verifierKind: "deployment_keyed_pbkdf2_sha256",
        keyedVerifierIterations: 600_000,
        keyedVerifierPepperVersion: 2,
        keyedVerifierVersion: 1,
      }),
    );
    expect(credential.keyedVerifierDigest).not.toBe(created.code);
    expect(credential.codeHash).toBeUndefined();
    expect(credential.plaintextCode).toBeUndefined();

    const result = await verify(ctx, {
      code: created.code,
      email: "pos@wigclub.store",
      storeId: STORE_ID,
    });

    expect(result).toEqual({ authUserId: AUTH_USER_ID });
    expect(ctx.tables.posRecoveryCredential[0].failedAttemptCount).toBe(0);
    expect(ctx.tables.posRecoveryCredential[0].lastUsedAt).toEqual(
      expect.any(Number),
    );
    expect(created.credential).not.toHaveProperty("plaintextCode");
    expect(created.credential).not.toHaveProperty("keyedVerifierDigest");
    expect(created.credential).not.toHaveProperty("keyedVerifierSalt");
    expect(JSON.stringify(ctx.tables.operationalEvent)).not.toContain(
      created.code,
    );
    expect(JSON.stringify(ctx.tables.operationalEvent)).not.toContain(
      credential.codeHash,
    );
  });

  it("prepares one exact Auth session from terminal-derived store authority and reuses it only after full proof and code revalidation", async () => {
    const ctx = buildCtx();
    const terminalProof = "terminal-proof-1";
    const terminalProofHash = await hashPosTerminalSyncSecret(terminalProof);
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const created = await create(ctx, { storeId: STORE_ID });
    Object.assign(ctx.tables, {
      authSessions: [],
      posRecoveryExchange: [],
      posTerminal: [
        {
          _id: "terminal-1",
          organizationId: ORG_ID,
          storeId: STORE_ID,
          status: "active",
          syncSecretHash: terminalProofHash,
          lifecycleRevision: 1,
          proofRevision: 1,
        },
      ],
      servicePrincipal: [
        {
          _id: "principal-1",
          organizationId: ORG_ID,
          storeId: STORE_ID,
          stableKey: "store.service",
          status: "active",
          lifecycleRevision: 1,
        },
      ],
      servicePrincipalAuthBinding: [],
      servicePrincipalCapability: [
        {
          _id: "grant-1",
          organizationId: ORG_ID,
          storeId: STORE_ID,
          servicePrincipalId: "principal-1",
          consumerId: "pos",
          capabilityId: "pos.application",
          status: "active",
          revision: 1,
        },
      ],
    });

    const args = {
      code: created.code,
      recoveryCorrelationKey: "recovery_correlation_0001",
      terminalId: "terminal-1",
      terminalProof,
    };
    const first = await prepareRecoveryForAuthProviderWithCtx(
      ctx as never,
      args as never,
    );
    const second = await prepareRecoveryForAuthProviderWithCtx(
      ctx as never,
      args as never,
    );

    expect(second).toEqual(first);
    expect(ctx.tables.authSessions).toHaveLength(1);
    expect(ctx.tables.posRecoveryExchange).toHaveLength(1);
    expect(ctx.tables.servicePrincipalAuthBinding).toHaveLength(1);
    expect(ctx.tables.posRecoveryCredential[0]).toEqual(
      expect.objectContaining({
        credentialRevision: 1,
        servicePrincipalId: "principal-1",
        verifierKind: "deployment_keyed_pbkdf2_sha256",
      }),
    );
    expect(ctx.tables.authSessions[0].expirationTime - Date.now()).toBeGreaterThan(
      89 * 24 * 60 * 60 * 1000,
    );

    await expect(
      prepareRecoveryForAuthProviderWithCtx(ctx as never, {
        ...args,
        code: "wrong-code",
      } as never),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      prepareRecoveryForAuthProviderWithCtx(ctx as never, {
        ...args,
        terminalProof: "wrong-proof",
      } as never),
    ).resolves.toEqual({ status: "denied" });
    expect(ctx.tables.authSessions).toHaveLength(1);
    expect(ctx.tables.posRecoveryExchange).toHaveLength(1);
  });

  it("rejects a legacy fast verifier on the enforced exact-session lane", async () => {
    const ctx = buildCtx();
    const created = await getHandler(createOrRotateRecoveryCodeForTest)(ctx, {
      storeId: STORE_ID,
    });
    const terminalProof = await seedExactRecoveryAuthority(ctx);
    const credential = ctx.tables.posRecoveryCredential[0];
    const codeSalt = "legacy-salt";
    Object.assign(credential, {
      codeHash: await hashPosRecoveryCode({ code: created.code, salt: codeSalt }),
      codeSalt,
      codeVersion: 1,
      verifierKind: "legacy_sha256",
      keyedVerifierDigest: undefined,
      keyedVerifierIterations: undefined,
      keyedVerifierPepperVersion: undefined,
      keyedVerifierSalt: undefined,
      keyedVerifierVersion: undefined,
    });

    await expect(
      prepareRecoveryForAuthProviderWithCtx(ctx as never, {
        code: created.code,
        recoveryCorrelationKey: "legacy_correlation_0001",
        terminalId: "terminal-1",
        terminalProof,
      } as never),
    ).resolves.toEqual({ status: "denied" });
    expect(credential.failedAttemptCount).toBe(0);
    expect(ctx.tables.posRecoveryExchange).toHaveLength(0);
    expect(ctx.tables.operationalEvent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "pos_service_recovery_denied",
          reason: "recovery_credential_verifier_unavailable",
          metadata: expect.objectContaining({
            proofValidated: true,
            recoveryCorrelationKey: "legacy_correlation_0001",
          }),
        }),
      ]),
    );
    expect(JSON.stringify(ctx.tables.operationalEvent)).not.toContain(
      created.code,
    );
    expect(JSON.stringify(ctx.tables.operationalEvent)).not.toContain(
      terminalProof,
    );
  });

  it("records a protected capability denial without changing public recovery output", async () => {
    const ctx = buildCtx();
    const created = await getHandler(createOrRotateRecoveryCodeForTest)(ctx, {
      storeId: STORE_ID,
    });
    const terminalProof = await seedExactRecoveryAuthority(ctx);
    ctx.tables.servicePrincipalCapability[0].status = "revoked";

    await expect(
      prepareRecoveryForAuthProviderWithCtx(ctx as never, {
        code: created.code,
        recoveryCorrelationKey: "capability_denial_0001",
        terminalId: "terminal-1",
        terminalProof,
      } as never),
    ).resolves.toEqual({ status: "denied" });

    expect(ctx.tables.authSessions).toHaveLength(0);
    expect(ctx.tables.posRecoveryExchange).toHaveLength(0);
    expect(ctx.tables.operationalEvent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "pos_service_recovery_denied",
          reason: "pos_capability_unavailable",
          metadata: expect.objectContaining({
            proofValidated: true,
            recoveryCorrelationKey: "capability_denial_0001",
          }),
        }),
      ]),
    );
    const serializedEvents = JSON.stringify(ctx.tables.operationalEvent);
    expect(serializedEvents).not.toContain(created.code);
    expect(serializedEvents).not.toContain(terminalProof);
  });

  it("temporarily throttles bounded code failures only after valid terminal proof", async () => {
    const ctx = buildCtx();
    await getHandler(createOrRotateRecoveryCodeForTest)(ctx, {
      storeId: STORE_ID,
    });
    const terminalProof = await seedExactRecoveryAuthority(ctx);
    const credential = ctx.tables.posRecoveryCredential[0];

    await expect(
      prepareRecoveryForAuthProviderWithCtx(ctx as never, {
        code: "wrong-before-proof",
        recoveryCorrelationKey: "invalid_proof_attempt_0001",
        terminalId: "terminal-1",
        terminalProof: "wrong-proof",
      } as never),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      prepareRecoveryForAuthProviderWithCtx(ctx as never, {
        code: "another-wrong-before-proof",
        recoveryCorrelationKey: "invalid_proof_attempt_0002",
        terminalId: "terminal-1",
        terminalProof: "another-wrong-proof",
      } as never),
    ).resolves.toEqual({ status: "denied" });
    expect(credential.failedAttemptCount).toBe(0);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        prepareRecoveryForAuthProviderWithCtx(ctx as never, {
          code: `wrong-code-${attempt}`,
          recoveryCorrelationKey: `valid_proof_attempt_000${attempt}`,
          terminalId: "terminal-1",
          terminalProof,
        } as never),
      ).resolves.toEqual({ status: "denied" });
    }
    expect(credential).toEqual(
      expect.objectContaining({
        failedAttemptCount: 5,
        failureWindowAttemptCount: 5,
        lockedAt: expect.any(Number),
        lockedUntil: expect.any(Number),
        status: "locked",
      }),
    );
    const denialEvents = ctx.tables.operationalEvent.filter(
      (event) => event.eventType === "pos_service_recovery_denied",
    );
    expect(
      denialEvents.filter((event) => event.reason === "invalid_terminal_proof"),
    ).toHaveLength(1);
    expect(
      denialEvents.filter((event) => event.reason === "invalid_recovery_code"),
    ).toHaveLength(5);
    expect(denialEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "invalid_terminal_proof",
          metadata: expect.objectContaining({
            proofValidated: false,
            recoveryCorrelationKey: "invalid_proof_attempt_0001",
          }),
        }),
      ]),
    );
    const serializedDenials = JSON.stringify(denialEvents);
    for (const secret of [
      terminalProof,
      "wrong-proof",
      "another-wrong-proof",
      "wrong-before-proof",
      "another-wrong-before-proof",
      "wrong-code-0",
      "wrong-code-4",
    ]) {
      expect(serializedDenials).not.toContain(secret);
    }
    expect(serializedDenials).not.toMatch(/jwt|refreshToken|terminalProof/i);
  });

  it("never validates a recovery credential or creates Auth state for a revoked terminal", async () => {
    const ctx = buildCtx();
    const created = await getHandler(createOrRotateRecoveryCodeForTest)(ctx, {
      storeId: STORE_ID,
    });
    const terminalProof = await seedExactRecoveryAuthority(ctx);
    const credential = ctx.tables.posRecoveryCredential[0];
    ctx.tables.posTerminal[0].status = "revoked";
    ctx.tables.posTerminal[0].fingerprintHash = "fingerprint-1";

    await expect(
      prepareRecoveryForAuthProviderWithCtx(ctx as never, {
        code: created.code,
        recoveryCorrelationKey: "revoked_terminal_attempt_0001",
        terminalId: "terminal-1",
        terminalProof,
      } as never),
    ).resolves.toEqual({ status: "denied" });

    expect(credential.failedAttemptCount).toBe(0);
    expect(credential.lastUsedAt).toBeUndefined();
    expect(ctx.tables.posRecoveryExchange).toHaveLength(0);
    expect(ctx.tables.authSessions).toHaveLength(0);
  });

  it("migrates persisted plaintext once or marks legacy rows rotation-required", async () => {
    const ctx = buildCtx();
    const created = await getHandler(createOrRotateRecoveryCodeForTest)(ctx, {
      storeId: STORE_ID,
    });
    const credential = ctx.tables.posRecoveryCredential[0];
    Object.assign(credential, {
      codeHash: "legacy-hash",
      codeSalt: "legacy-salt",
      codeVersion: 1,
      credentialRevision: 1,
      plaintextCode: created.code,
      verifierKind: "legacy_sha256",
      keyedVerifierDigest: undefined,
    });

    await expect(
      migrateLegacyRecoveryCredentialWithCtx(ctx as never, {
        credentialId: credential._id,
        now: 500,
      }),
    ).resolves.toEqual({ disposition: "migrated" });
    expect(credential).toEqual(
      expect.objectContaining({
        credentialRevision: 2,
        legacyMigrationAt: 500,
        legacyMigrationStatus: "migrated",
        plaintextCode: undefined,
        plaintextRemovedAt: 500,
        verifierKind: "deployment_keyed_pbkdf2_sha256",
      }),
    );

    const other = { ...credential, _id: "legacy-without-plaintext" };
    Object.assign(other, {
      verifierKind: "legacy_sha256",
      plaintextCode: undefined,
      legacyMigrationStatus: "pending",
    });
    ctx.tables.posRecoveryCredential.push(other);
    await expect(
      migrateLegacyRecoveryCredentialWithCtx(ctx as never, {
        credentialId: other._id,
        now: 600,
      }),
    ).resolves.toEqual({ disposition: "rotation_required" });
    expect(other).toEqual(
      expect.objectContaining({
        legacyMigrationAt: 600,
        legacyMigrationStatus: "rotation_required",
        rotationRequiredAt: 600,
      }),
    );
  });

  it("verifies recovery codes through org and store slugs", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);

    const created = await create(ctx, { storeId: STORE_ID });

    await expect(
      verify(ctx, {
        code: created.code,
        email: "pos@wigclub.store",
        orgUrlSlug: "wigclub",
        storeUrlSlug: "wigclub",
      }),
    ).resolves.toEqual({ authUserId: AUTH_USER_ID });
    expect(ctx.queryLog).toEqual(
      expect.arrayContaining([
        "by_slug",
        "by_organizationId_slug",
        "by_organizationId_userId",
      ]),
    );
  });

  it("accepts recovery codes without exact casing or word separators", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);

    const created = await create(ctx, { storeId: STORE_ID });
    const staffTypedCode = created.code
      .replace(/(.{4})/g, "$1 ")
      .trim()
      .toUpperCase();

    await expect(
      verify(ctx, {
        code: staffTypedCode,
        email: "pos@wigclub.store",
        storeId: STORE_ID,
      }),
    ).resolves.toEqual({ authUserId: AUTH_USER_ID });
  });

  it("rejects mismatched org and store slugs before credential failure accounting", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);
    const created = await create(ctx, { storeId: STORE_ID });

    await expect(
      verify(ctx, {
        code: created.code,
        email: "pos@wigclub.store",
        orgUrlSlug: "wigclub",
        storeUrlSlug: "unknown",
      }),
    ).rejects.toThrow("POS recovery sign-in failed.");

    expect(ctx.tables.posRecoveryCredential[0].failedAttemptCount).toBe(0);
    expect(ctx.tables.operationalEvent).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "pos_recovery_code_login_failed",
        }),
      ]),
    );
  });

  it("invalidates old codes when rotated", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);

    const first = await create(ctx, { storeId: STORE_ID });
    const second = await create(ctx, { storeId: STORE_ID });

    await expect(
      verify(ctx, {
        code: first.code,
        email: "pos@wigclub.store",
        storeId: STORE_ID,
      }),
    ).rejects.toThrow("POS recovery sign-in failed.");

    await expect(
      verify(ctx, {
        code: second.code,
        email: "pos@wigclub.store",
        storeId: STORE_ID,
      }),
    ).resolves.toEqual({ authUserId: AUTH_USER_ID });
  });

  it("records repeated wrong attempts without letting public guessing lock the credential", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);

    const created = await create(ctx, { storeId: STORE_ID });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        verify(ctx, {
          code: `wrong-${attempt}`,
          email: "pos@wigclub.store",
          storeId: STORE_ID,
        }),
      ).rejects.toThrow("POS recovery sign-in failed.");
    }

    expect(ctx.tables.posRecoveryCredential[0]).toEqual(
      expect.objectContaining({
        failedAttemptCount: 1,
        failureAuditBucket: expect.any(Number),
        lastFailedAt: expect.any(Number),
        status: "active",
      }),
    );
    expect(ctx.tables.posRecoveryCredential[0]).not.toHaveProperty("lockedAt");
    expect(ctx.tables.posRecoveryCredential[0]).not.toHaveProperty(
      "lockedUntil",
    );
    const failedAttemptEvents = ctx.tables.operationalEvent.filter(
      (event) => event.eventType === "pos_recovery_code_login_failed",
    );
    expect(failedAttemptEvents).toHaveLength(1);
    expect(failedAttemptEvents[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          failedAttemptCount: 1,
          failureAuditBucket: expect.any(Number),
          reason: "invalid_code",
        }),
      }),
    );

    await expect(
      verify(ctx, {
        code: created.code,
        email: "pos@wigclub.store",
        storeId: STORE_ID,
      }),
    ).resolves.toEqual({ authUserId: AUTH_USER_ID });
  });

  it("rejects non-POS account emails without inspecting submitted code details", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);

    const created = await create(ctx, { storeId: STORE_ID });

    await expect(
      verify(ctx, {
        code: created.code,
        email: "admin@wigclub.store",
        storeId: STORE_ID,
      }),
    ).rejects.toThrow("POS recovery sign-in failed.");
  });

  it("limits recovery-code status to full admins", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const getStatus = getHandler(getRecoveryCodeStatus);

    await create(ctx, { storeId: STORE_ID });

    authServerMocks.getAuthUserId.mockResolvedValue(FULL_ADMIN_AUTH_USER_ID);
    await expect(getStatus(ctx, { storeId: STORE_ID })).resolves.toEqual(
      expect.objectContaining({
        status: "active",
        storeId: STORE_ID,
      }),
    );
    const status = await getStatus(ctx, { storeId: STORE_ID });
    expect(status).not.toHaveProperty("plaintextCode");
    expect(status).not.toHaveProperty("keyedVerifierDigest");
    expect(status).not.toHaveProperty("keyedVerifierSalt");

    authServerMocks.getAuthUserId.mockResolvedValue(AUTH_USER_ID);
    await expect(getStatus(ctx, { storeId: STORE_ID })).rejects.toThrow(
      "Only full admins can manage POS recovery codes.",
    );
  });

  it("lets full admins rotate through the public mutation with actor attribution", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const rotate = getHandler(rotateRecoveryCode);
    await create(ctx, { storeId: STORE_ID });

    authServerMocks.getAuthUserId.mockResolvedValue(FULL_ADMIN_AUTH_USER_ID);
    const result = await rotate(ctx, { storeId: STORE_ID });

    expect(result.code).toMatch(RECOVERY_CODE_PATTERN);
    expect(result.credential).toEqual(
      expect.objectContaining({
        rotatedByUserId: FULL_ADMIN_ID,
        status: "active",
        storeId: STORE_ID,
      }),
    );
    expect(ctx.tables.posRecoveryCredential[0]).toEqual(
      expect.objectContaining({
        rotatedByUserId: FULL_ADMIN_ID,
        status: "active",
        verifierKind: "deployment_keyed_pbkdf2_sha256",
      }),
    );
    expect(ctx.tables.posRecoveryCredential[0].plaintextCode).toBeUndefined();
    expect(result.credential).not.toHaveProperty("plaintextCode");
    expect(ctx.tables.operationalEvent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: FULL_ADMIN_ID,
          eventType: "pos_recovery_code_rotated",
          metadata: expect.objectContaining({ reason: "rotated" }),
        }),
      ]),
    );
  });

  it.each([
    {
      label: "missing POS membership",
      mutate: (ctx: ReturnType<typeof buildCtx>) => {
        ctx.tables.organizationMember = ctx.tables.organizationMember.filter(
          (member) => member.userId !== POS_ACCOUNT_ID,
        );
      },
      reason: "POS recovery account must have POS-only access.",
    },
    {
      label: "admin POS membership",
      mutate: (ctx: ReturnType<typeof buildCtx>) => {
        const membership = ctx.tables.organizationMember.find(
          (member) => member.userId === POS_ACCOUNT_ID,
        );
        membership.role = "full_admin";
      },
      reason: "POS recovery account must have POS-only access.",
    },
    {
      label: "missing auth user",
      mutate: (ctx: ReturnType<typeof buildCtx>) => {
        ctx.tables.users = ctx.tables.users.filter(
          (user) => user.email !== "pos@wigclub.store",
        );
      },
      reason: "POS recovery account auth user is not configured.",
    },
  ])(
    "does not generate recovery codes for $label",
    async ({ mutate, reason }) => {
      const ctx = buildCtx();
      const rotate = getHandler(rotateRecoveryCode);
      mutate(ctx);

      authServerMocks.getAuthUserId.mockResolvedValue(FULL_ADMIN_AUTH_USER_ID);
      await expect(rotate(ctx, { storeId: STORE_ID })).rejects.toThrow(reason);

      expect(ctx.tables.posRecoveryCredential).toHaveLength(0);
      expect(ctx.tables.operationalEvent).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: expect.stringMatching(/^pos_recovery_code_/),
          }),
        ]),
      );
    },
  );

  it.each([
    {
      label: "missing membership",
      mutate: (ctx: ReturnType<typeof buildCtx>) => {
        ctx.tables.organizationMember = ctx.tables.organizationMember.filter(
          (member) => member.userId !== POS_ACCOUNT_ID,
        );
      },
    },
    {
      label: "membership in another organization",
      mutate: (ctx: ReturnType<typeof buildCtx>) => {
        const membership = ctx.tables.organizationMember.find(
          (member) => member.userId === POS_ACCOUNT_ID,
        );
        membership.organizationId = "org-other";
      },
    },
    {
      label: "non-POS-only membership",
      mutate: (ctx: ReturnType<typeof buildCtx>) => {
        const membership = ctx.tables.organizationMember.find(
          (member) => member.userId === POS_ACCOUNT_ID,
        );
        membership.role = "full_admin";
      },
    },
  ])("rejects recovery verification for $label", async ({ mutate }) => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);
    const created = await create(ctx, { storeId: STORE_ID });
    mutate(ctx);
    const credential = ctx.tables.posRecoveryCredential[0];

    await expect(
      verify(ctx, {
        code: created.code,
        email: "pos@wigclub.store",
        storeId: STORE_ID,
      }),
    ).rejects.toThrow("POS recovery sign-in failed.");

    expect(credential.failedAttemptCount).toBe(0);
    expect(ctx.tables.operationalEvent).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "pos_recovery_code_login_failed",
        }),
      ]),
    );
  });

  it("rejects locked credentials until full-admin unlock clears lock fields", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);
    const unlock = getHandler(unlockRecoveryCode);
    const created = await create(ctx, { storeId: STORE_ID });
    Object.assign(ctx.tables.posRecoveryCredential[0], {
      failedAttemptCount: 5,
      lockedAt: 100,
      lockedUntil: Date.now() + 60_000,
      status: "locked",
    });

    await expect(
      verify(ctx, {
        code: created.code,
        email: "pos@wigclub.store",
        storeId: STORE_ID,
      }),
    ).rejects.toThrow("POS recovery sign-in failed.");
    await expect(
      verify(ctx, {
        code: created.code,
        email: "pos@wigclub.store",
        storeId: STORE_ID,
      }),
    ).rejects.toThrow("POS recovery sign-in failed.");
    expect(
      ctx.tables.operationalEvent.filter(
        (event) =>
          event.eventType === "pos_recovery_code_login_failed" &&
          event.reason === "locked",
      ),
    ).toHaveLength(1);

    authServerMocks.getAuthUserId.mockResolvedValue(FULL_ADMIN_AUTH_USER_ID);
    await expect(unlock(ctx, { storeId: STORE_ID })).resolves.toEqual(
      expect.objectContaining({ status: "active" }),
    );
    expect(ctx.tables.posRecoveryCredential[0]).toEqual(
      expect.objectContaining({
        failedAttemptCount: 0,
        failureAuditBucket: undefined,
        lockedAt: undefined,
        lockedUntil: undefined,
        status: "active",
      }),
    );
    expect(ctx.tables.operationalEvent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "pos_recovery_code_unlocked",
          metadata: expect.objectContaining({ reason: "unlocked" }),
        }),
      ]),
    );
  });

  it("revokes credentials and keeps revoked credentials unusable", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const revoke = getHandler(revokeRecoveryCode);
    const unlock = getHandler(unlockRecoveryCode);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);
    const created = await create(ctx, { storeId: STORE_ID });

    authServerMocks.getAuthUserId.mockResolvedValue(FULL_ADMIN_AUTH_USER_ID);
    await expect(revoke(ctx, { storeId: STORE_ID })).resolves.toEqual(
      expect.objectContaining({ status: "revoked" }),
    );
    await expect(unlock(ctx, { storeId: STORE_ID })).resolves.toEqual(
      expect.objectContaining({ status: "revoked" }),
    );

    await expect(
      verify(ctx, {
        code: created.code,
        email: "pos@wigclub.store",
        storeId: STORE_ID,
      }),
    ).rejects.toThrow("POS recovery sign-in failed.");
    await expect(
      verify(ctx, {
        code: created.code,
        email: "pos@wigclub.store",
        storeId: STORE_ID,
      }),
    ).rejects.toThrow("POS recovery sign-in failed.");
    expect(
      ctx.tables.operationalEvent.filter(
        (event) =>
          event.eventType === "pos_recovery_code_login_failed" &&
          event.reason === "revoked",
      ),
    ).toHaveLength(1);
    expect(ctx.tables.operationalEvent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "pos_recovery_code_revoked",
          metadata: expect.objectContaining({ reason: "revoked" }),
        }),
      ]),
    );
  });

  it("rejects non-full-admin recovery-code management", async () => {
    const ctx = buildCtx();
    const rotate = getHandler(rotateRecoveryCode);
    const revoke = getHandler(revokeRecoveryCode);
    const unlock = getHandler(unlockRecoveryCode);
    authServerMocks.getAuthUserId.mockResolvedValue(AUTH_USER_ID);

    await expect(rotate(ctx, { storeId: STORE_ID })).rejects.toThrow(
      "Only full admins can manage POS recovery codes.",
    );
    await expect(revoke(ctx, { storeId: STORE_ID })).rejects.toThrow(
      "Only full admins can manage POS recovery codes.",
    );
    await expect(unlock(ctx, { storeId: STORE_ID })).rejects.toThrow(
      "Only full admins can manage POS recovery codes.",
    );
  });
});

async function seedExactRecoveryAuthority(ctx: ReturnType<typeof buildCtx>) {
  const terminalProof = "terminal-proof-1";
  const terminalProofHash = await hashPosTerminalSyncSecret(terminalProof);
  Object.assign(ctx.tables, {
    authSessions: [],
    posRecoveryExchange: [],
    posTerminal: [
      {
        _id: "terminal-1",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        status: "active",
        syncSecretHash: terminalProofHash,
        lifecycleRevision: 1,
        proofRevision: 1,
      },
    ],
    servicePrincipal: [
      {
        _id: "principal-1",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        stableKey: "store.service",
        status: "active",
        lifecycleRevision: 1,
      },
    ],
    servicePrincipalAuthBinding: [],
    servicePrincipalCapability: [
      {
        _id: "grant-1",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        servicePrincipalId: "principal-1",
        consumerId: "pos",
        capabilityId: "pos.application",
        status: "active",
        revision: 1,
      },
    ],
  });
  return terminalProof;
}

function buildCtx() {
  let nextId = 1;
  const tables: Record<string, any[]> = {
    athenaUser: [
      { _id: POS_ACCOUNT_ID, email: "pos@wigclub.store" },
      { _id: FULL_ADMIN_ID, email: "admin@wigclub.store" },
    ],
    organization: [{ _id: ORG_ID, slug: "wigclub" }],
    organizationMember: [
      {
        _id: "member-1",
        organizationId: ORG_ID,
        role: "pos_only",
        userId: POS_ACCOUNT_ID,
      },
      {
        _id: "member-2",
        organizationId: ORG_ID,
        role: "full_admin",
        userId: FULL_ADMIN_ID,
      },
    ],
    operationalEvent: [],
    authSessions: [],
    posRecoveryCredential: [],
    posRecoveryExchange: [],
    posTerminal: [],
    posTerminalReconnectIntent: [],
    store: [{ _id: STORE_ID, organizationId: ORG_ID, slug: "wigclub" }],
    users: [
      { _id: AUTH_USER_ID, email: "pos@wigclub.store" },
      { _id: FULL_ADMIN_AUTH_USER_ID, email: "admin@wigclub.store" },
    ],
  };

  const queryLog: string[] = [];
  const ctx = {
    queryLog,
    tables,
    db: {
      get: vi.fn(async (tableOrId: string, maybeId?: string) => {
        if (maybeId !== undefined) {
          return tables[tableOrId]?.find((row) => row._id === maybeId) ?? null;
        }
        return (
          Object.values(tables)
            .flat()
            .find((row) => row._id === tableOrId) ?? null
        );
      }),
      insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
        const id = `${table}-${nextId++}`;
        tables[table].push({ _id: id, _creationTime: Date.now(), ...value });
        return id;
      }),
      patch: vi.fn(
        async (
          ...args:
            | [string, string, Record<string, unknown>]
            | [string, Record<string, unknown>]
        ) => {
          const id = args.length === 3 ? args[1] : args[0];
          const patch = args.length === 3 ? args[2] : args[1];
          const row = Object.values(tables)
            .flat()
            .find((candidate) => candidate._id === id);
          if (!row) {
            throw new Error(`Missing row ${id}`);
          }
          Object.assign(row, patch);
        },
      ),
      query: vi.fn((table: string) =>
        createQuery(tables[table] ?? [], queryLog),
      ),
    },
  };

  return ctx;
}

function createQuery(rows: any[], queryLog: string[]) {
  let currentRows = rows;
  const query = {
    collect: vi.fn(async () => currentRows),
    filter: vi.fn((predicate: Function) => {
      currentRows = currentRows.filter((row) => predicate(createFilter(row)));
      return query;
    }),
    first: vi.fn(async () => currentRows[0] ?? null),
    order: vi.fn((direction: "asc" | "desc") => {
      currentRows = [...currentRows].sort((left, right) => {
        const difference =
          (left._creationTime ?? left.createdAt ?? 0) -
          (right._creationTime ?? right.createdAt ?? 0);
        return direction === "desc" ? -difference : difference;
      });
      return query;
    }),
    take: vi.fn(async (limit: number) => currentRows.slice(0, limit)),
    withIndex: vi.fn((name: string, predicate?: Function) => {
      queryLog.push(name);
      if (predicate) {
        const indexBuilder = {
          eq: (field: string, value: unknown) => {
            currentRows = currentRows.filter((row) => row[field] === value);
            return indexBuilder;
          },
          gte: (field: string, value: number) => {
            currentRows = currentRows.filter((row) => row[field] >= value);
            return indexBuilder;
          },
        };
        predicate(indexBuilder);
      }
      return query;
    }),
  };
  return query;
}

function createFilter(row: Record<string, unknown>) {
  return {
    and: (...values: boolean[]) => values.every(Boolean),
    eq: (left: unknown, right: unknown) => left === right,
    field: (name: string) => row[name],
    or: (...values: boolean[]) => values.some(Boolean),
  };
}

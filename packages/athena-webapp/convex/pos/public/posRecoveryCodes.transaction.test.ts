/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import schema from "../../schema";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";
import {
  createOrRotateRecoveryCodeForTest,
  prepareRecoveryForAuthProviderWithCtx,
} from "./posRecoveryCodes";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.ts")).map(([path, loader]) => [
    path.replace(/^\.\.\/\.\.\//, "./"),
    loader,
  ]),
);

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("POS recovery-code transaction behavior", () => {
  beforeEach(() => {
    process.env.POS_RECOVERY_CODE_ACTIVE_PEPPER_VERSION = "2";
    process.env.POS_RECOVERY_CODE_PEPPERS_JSON = JSON.stringify({
      2: "transaction-test-pepper-material-0000000002",
    });
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

  it("commits failed-attempt throttling and secret-free audit evidence on denial", async () => {
    const t = convexTest(schema, modules);
    const terminalProof = "transaction-terminal-proof";
    const scope = await t.run(async (ctx) => {
      const adminUserId = await ctx.db.insert("athenaUser", {
        email: "admin@example.com",
        normalizedEmail: "admin@example.com",
      });
      const posAccountId = await ctx.db.insert("athenaUser", {
        email: "pos@wigclub.store",
        normalizedEmail: "pos@wigclub.store",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: adminUserId,
        name: "Transaction Test Org",
        slug: "transaction-test-org",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: adminUserId,
        currency: "USD",
        name: "Transaction Test Store",
        organizationId,
        slug: "transaction-test-store",
      });
      await ctx.db.insert("organizationMember", {
        organizationId,
        role: "pos_only",
        userId: posAccountId,
      });
      await ctx.db.insert("users", { email: "pos@wigclub.store" });
      const servicePrincipalId = await ctx.db.insert("servicePrincipal", {
        createdAt: 1,
        lastCorrelationId: "transaction-principal",
        lifecycleRevision: 1,
        organizationId,
        stableKey: "store.service",
        status: "active",
        storeId,
        updatedAt: 1,
      });
      await ctx.db.insert("servicePrincipalCapability", {
        capabilityId: "pos.application",
        consumerId: "pos",
        grantedAt: 1,
        lastCorrelationId: "transaction-capability",
        organizationId,
        revision: 1,
        servicePrincipalId,
        status: "active",
        storeId,
        updatedAt: 1,
      });
      const terminalId = await ctx.db.insert("posTerminal", {
        browserInfo: { userAgent: "transaction-test" },
        displayName: "Transaction terminal",
        fingerprintHash: "transaction-fingerprint",
        lifecycleRevision: 1,
        organizationId,
        proofRevision: 1,
        registeredAt: 1,
        registeredByUserId: adminUserId,
        status: "active",
        storeId,
        syncSecretHash: await hashPosTerminalSyncSecret(terminalProof),
      });
      return { storeId, terminalId };
    });
    await t.run((ctx) =>
      getHandler(createOrRotateRecoveryCodeForTest)(ctx, {
        storeId: scope.storeId,
      }),
    );

    const submittedCodes: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `wrong-transaction-code-${attempt}`;
      submittedCodes.push(code);
      await expect(
        t.run((ctx) =>
          prepareRecoveryForAuthProviderWithCtx(ctx, {
            code,
            recoveryCorrelationKey: `transaction_attempt_000${attempt}`,
            terminalId: scope.terminalId,
            terminalProof,
          }),
        ),
      ).resolves.toEqual({ status: "denied" });
    }

    const persisted = await t.run(async (ctx) => {
      const events = await ctx.db.query("operationalEvent").take(20);
      return {
        credential: await ctx.db
          .query("posRecoveryCredential")
          .withIndex("by_storeId", (query) =>
            query.eq("storeId", scope.storeId),
          )
          .unique(),
        denialEvents: events.filter(
          (event) => event.eventType === "pos_service_recovery_denied",
        ),
        failureEvents: events.filter(
          (event) => event.eventType === "pos_recovery_code_login_failed",
        ),
      };
    });

    expect(persisted.credential).toEqual(
      expect.objectContaining({
        failedAttemptCount: 5,
        failureWindowAttemptCount: 5,
        lockedAt: expect.any(Number),
        lockedUntil: expect.any(Number),
        status: "locked",
      }),
    );
    expect(persisted.failureEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "invalid_code" }),
        expect.objectContaining({ reason: "throttled" }),
      ]),
    );
    expect(persisted.denialEvents).toHaveLength(5);
    expect(persisted.denialEvents).toEqual(
      expect.arrayContaining(
        submittedCodes.map((_code, attempt) =>
          expect.objectContaining({
            reason: "invalid_recovery_code",
            metadata: expect.objectContaining({
              proofValidated: true,
              recoveryCorrelationKey: `transaction_attempt_000${attempt}`,
            }),
          }),
        ),
      ),
    );
    const serializedEvents = JSON.stringify([
      ...persisted.failureEvents,
      ...persisted.denialEvents,
    ]);
    expect(serializedEvents).not.toContain(terminalProof);
    for (const code of submittedCodes) {
      expect(serializedEvents).not.toContain(code);
    }
    expect(serializedEvents).not.toContain(
      "transaction-test-pepper-material-0000000002",
    );
    expect(serializedEvents).not.toMatch(/jwt|refreshToken|terminalProof/i);
  });
});

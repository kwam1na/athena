import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";

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
        },
      },
    });
  });

  it("creates a persisted credential and verifies the generated code", async () => {
    const ctx = buildCtx();
    const create = getHandler(createOrRotateRecoveryCodeForTest);
    const verify = getHandler(verifyRecoveryCodeForAuthProvider);

    const created = await create(ctx, { storeId: STORE_ID });

    expect(created.code).toMatch(RECOVERY_CODE_PATTERN);
    expect(ctx.tables.posRecoveryCredential).toHaveLength(1);
    const credential = ctx.tables.posRecoveryCredential[0];
    expect(credential.codeHash).not.toBe(created.code);

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
    expect(created.credential).toEqual(
      expect.objectContaining({
        plaintextCode: created.code,
      }),
    );
    expect(JSON.stringify(ctx.tables.operationalEvent)).not.toContain(
      created.code,
    );
    expect(JSON.stringify(ctx.tables.operationalEvent)).not.toContain(
      credential.codeHash,
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
    expect(ctx.tables.posRecoveryCredential[0]).not.toHaveProperty("lockedUntil");
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
        plaintextCode: expect.any(String),
        status: "active",
        storeId: STORE_ID,
      }),
    );

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
        plaintextCode: result.code,
        rotatedByUserId: FULL_ADMIN_ID,
        status: "active",
      }),
    );
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
  ])("does not generate recovery codes for $label", async ({ mutate, reason }) => {
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
  });

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
    posRecoveryCredential: [],
    store: [{ _id: STORE_ID, organizationId: ORG_ID, slug: "wigclub" }],
    users: [
      { _id: AUTH_USER_ID, email: "pos@wigclub.store" },
      { _id: FULL_ADMIN_AUTH_USER_ID, email: "admin@wigclub.store" },
    ],
  };

  const ctx = {
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
      patch: vi.fn(async (...args: [string, string, Record<string, unknown>] | [string, Record<string, unknown>]) => {
        const id = args.length === 3 ? args[1] : args[0];
        const patch = args.length === 3 ? args[2] : args[1];
        const row = Object.values(tables)
          .flat()
          .find((candidate) => candidate._id === id);
        if (!row) {
          throw new Error(`Missing row ${id}`);
        }
        Object.assign(row, patch);
      }),
      query: vi.fn((table: string) => createQuery(tables[table] ?? [])),
    },
  };

  return ctx;
}

function createQuery(rows: any[]) {
  let currentRows = rows;
  const query = {
    collect: vi.fn(async () => currentRows),
    filter: vi.fn((predicate: Function) => {
      currentRows = currentRows.filter((row) => predicate(createFilter(row)));
      return query;
    }),
    first: vi.fn(async () => currentRows[0] ?? null),
    take: vi.fn(async (limit: number) => currentRows.slice(0, limit)),
    withIndex: vi.fn((_name: string, predicate?: Function) => {
      if (predicate) {
        const indexBuilder = {
          eq: (field: string, value: unknown) => {
            currentRows = currentRows.filter((row) => row[field] === value);
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

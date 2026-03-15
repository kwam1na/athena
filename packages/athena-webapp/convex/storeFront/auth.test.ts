// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { SignJWTMock } = vi.hoisted(() => {
  class MockSignJWT {
    private readonly payload: Record<string, unknown>;

    constructor(payload: Record<string, unknown>) {
      this.payload = payload;
    }

    setProtectedHeader() {
      return this;
    }

    setExpirationTime() {
      return this;
    }

    async sign() {
      return `token-for-${String(this.payload.userId)}`;
    }
  }

  return {
    SignJWTMock: MockSignJWT,
  };
});

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(
  definition: T
) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}

function createDbHarness({
  queryQueues = {},
  records = {},
  insertIds = {},
}: {
  queryQueues?: Record<string, any[]>;
  records?: Record<string, any>;
  insertIds?: Record<string, string[]>;
} = {}) {
  const queueMap = new Map<string, any[]>(
    Object.entries(queryQueues).map(([key, value]) => [key, [...value]])
  );
  const recordMap = new Map<string, any>(Object.entries(records));
  const insertMap = new Map<string, string[]>(
    Object.entries(insertIds).map(([key, value]) => [key, [...value]])
  );
  let insertCounter = 0;

  const take = (key: string) => {
    const queue = queueMap.get(key) || [];
    const value = queue.length > 0 ? queue.shift() : undefined;
    queueMap.set(key, queue);
    return value;
  };

  const filterOps = {
    field: vi.fn((name: string) => name),
    eq: vi.fn(() => true),
    neq: vi.fn(() => true),
    and: vi.fn((...values: boolean[]) => values.every(Boolean)),
    or: vi.fn((...values: boolean[]) => values.some(Boolean)),
    gte: vi.fn(() => true),
    lte: vi.fn(() => true),
    lt: vi.fn(() => true),
  };
  const indexOps = {
    eq: vi.fn(() => indexOps),
  };

  const db = {
    query: vi.fn((table: string) => {
      const chain: any = {};
      chain.filter = vi.fn((callback?: (q: typeof filterOps) => unknown) => {
        if (callback) {
          callback(filterOps);
        }
        return chain;
      });
      chain.withIndex = vi.fn(
        (_name: string, callback?: (q: typeof indexOps) => unknown) => {
          if (callback) {
            callback(indexOps);
          }
          return chain;
        }
      );
      chain.order = vi.fn(() => chain);
      chain.first = vi.fn(async () => take(`${table}:first`) ?? null);
      chain.collect = vi.fn(async () => take(`${table}:collect`) ?? []);
      return chain;
    }),
    get: vi.fn(async (id: string) => recordMap.get(id) ?? null),
    insert: vi.fn(async (table: string, value: any) => {
      const ids = insertMap.get(table) || [];
      const nextId =
        ids.length > 0 ? ids.shift()! : `${table}_${++insertCounter}`;
      insertMap.set(table, ids);
      recordMap.set(nextId, { _id: nextId, ...value });
      return nextId;
    }),
    patch: vi.fn(async (id: string, patch: any) => {
      const current = recordMap.get(id) || { _id: id };
      recordMap.set(id, { ...current, ...patch });
    }),
  };

  return { db, recordMap };
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    action: wrapDefinition,
    mutation: wrapDefinition,
  }));

  vi.doMock("../_generated/api", () => ({
    api: {
      storeFront: {
        auth: {
          requestVerificationCode: "auth.requestVerificationCode",
        },
      },
      inventory: {
        stores: {
          findById: "stores.findById",
        },
      },
    },
  }));

  vi.doMock("../sendgrid", () => ({
    sendVerificationCode: vi.fn(),
  }));

  vi.doMock("jose", () => ({
    SignJWT: SignJWTMock,
  }));

  return import("./auth");
}

describe("storeFront auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rate limits verification code requests within cooldown", async () => {
    const { requestVerificationCode } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "storeFrontVerificationCode:first": [
          {
            _id: "vc_1",
            _creationTime: Date.now() - 30_000,
          },
        ],
      },
    });

    const result = await requestVerificationCode.handler({ db } as never, {
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      storeId: "store_1",
    });

    expect(result).toEqual({
      rateLimited: true,
      message: "Please wait before requesting another verification code.",
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates and returns a new verification code record", async () => {
    const { requestVerificationCode } = await loadModule();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const { db, recordMap } = createDbHarness({
      queryQueues: {
        "storeFrontVerificationCode:first": [null],
      },
      insertIds: {
        storeFrontVerificationCode: ["vc_2"],
      },
    });

    const result = await requestVerificationCode.handler({ db } as never, {
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      storeId: "store_1",
    });

    expect(db.insert).toHaveBeenCalledWith(
      "storeFrontVerificationCode",
      expect.objectContaining({
        email: "ada@example.com",
        code: "100000",
        isUsed: false,
      })
    );
    expect(result).toEqual(recordMap.get("vc_2"));
  });

  it("rejects invalid verification code", async () => {
    const { verifyCode } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "storeFrontVerificationCode:first": [null],
      },
    });

    const result = await verifyCode.handler({ db } as never, {
      code: "111111",
      email: "ada@example.com",
      storeId: "store_1",
      organizationId: "org_1",
    });

    expect(result).toEqual({
      error: true,
      message: "Invalid verification code",
    });
  });

  it("rejects expired and used verification codes", async () => {
    const { verifyCode } = await loadModule();
    const expiredHarness = createDbHarness({
      queryQueues: {
        "storeFrontVerificationCode:first": [
          {
            _id: "vc_expired",
            code: "111111",
            email: "ada@example.com",
            expiration: Date.now() - 1,
            isUsed: false,
          },
        ],
      },
    });

    const expiredResult = await verifyCode.handler(
      { db: expiredHarness.db } as never,
      {
        code: "111111",
        email: "ada@example.com",
        storeId: "store_1",
        organizationId: "org_1",
      }
    );

    expect(expiredResult).toEqual({
      error: true,
      message: "This verification code has expired",
    });

    const usedHarness = createDbHarness({
      queryQueues: {
        "storeFrontVerificationCode:first": [
          {
            _id: "vc_used",
            code: "111111",
            email: "ada@example.com",
            expiration: Date.now() + 10_000,
            isUsed: true,
          },
        ],
      },
    });

    const usedResult = await verifyCode.handler({ db: usedHarness.db } as never, {
      code: "111111",
      email: "ada@example.com",
      storeId: "store_1",
      organizationId: "org_1",
    });

    expect(usedResult).toEqual({
      error: true,
      message: "This verification code has already been used",
    });
  });

  it("uses existing user and creates session tokens", async () => {
    const { verifyCode } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "storeFrontVerificationCode:first": [
          {
            _id: "vc_3",
            email: "ada@example.com",
            expiration: Date.now() + 60_000,
            isUsed: false,
            firstName: "Ada",
            lastName: "Lovelace",
          },
        ],
        "storeFrontUser:first": [
          {
            _id: "user_1",
            email: "ada@example.com",
          },
        ],
      },
    });

    const result = await verifyCode.handler({ db } as never, {
      code: "123456",
      email: "ada@example.com",
      storeId: "store_1",
      organizationId: "org_1",
    });

    expect(db.patch).toHaveBeenCalledWith("vc_3", { isUsed: true });
    expect(db.insert).toHaveBeenCalledWith("storeFrontSession", {
      userId: "user_1",
      refreshToken: "token-for-user_1",
    });
    expect(result).toEqual({
      success: true,
      user: {
        _id: "user_1",
        email: "ada@example.com",
      },
      accessToken: "token-for-user_1",
      refreshToken: "token-for-user_1",
    });
  });

  it("creates a new user and returns retrieval error if inserted user is missing", async () => {
    const { verifyCode } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "storeFrontVerificationCode:first": [
          {
            _id: "vc_4",
            email: "new@example.com",
            expiration: Date.now() + 60_000,
            isUsed: false,
            firstName: "New",
            lastName: "User",
          },
        ],
        "storeFrontUser:first": [null],
      },
      insertIds: {
        storeFrontUser: ["user_missing"],
      },
    });

    db.get.mockImplementation(async (id: string) => {
      if (id === "user_missing") {
        return null;
      }
      return null;
    });

    const result = await verifyCode.handler({ db } as never, {
      code: "123456",
      email: "new@example.com",
      storeId: "store_1",
      organizationId: "org_1",
    });

    expect(result).toEqual({
      error: true,
      message: "Could not retrieve user",
    });
  });

  it("sends verification code via provider with success and failure branches", async () => {
    const { sendVerificationCodeViaProvider } = await loadModule();

    const missingCtx = {
      runMutation: vi.fn().mockResolvedValue(null),
      runQuery: vi.fn().mockResolvedValue({ _id: "store_1" }),
    };

    const missingResult = await sendVerificationCodeViaProvider.handler(
      missingCtx as never,
      {
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        storeId: "store_1",
      }
    );

    expect(missingResult).toEqual({
      success: false,
      message: "Could not send verification code",
    });

    const rateLimitedCtx = {
      runMutation: vi.fn().mockResolvedValue({
        rateLimited: true,
        message: "Please wait before requesting another verification code.",
      }),
      runQuery: vi.fn().mockResolvedValue({ _id: "store_1" }),
    };

    const rateLimitedResult = await sendVerificationCodeViaProvider.handler(
      rateLimitedCtx as never,
      {
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        storeId: "store_1",
      }
    );

    expect(rateLimitedResult).toEqual({
      success: false,
      message: "Please wait before requesting another verification code.",
    });

    const successCtx = {
      runMutation: vi.fn().mockResolvedValue({
        _id: "vc_5",
        code: "123456",
      }),
      runQuery: vi.fn().mockResolvedValue({ _id: "store_1", name: "Athena" }),
    };

    const successResult = await sendVerificationCodeViaProvider.handler(
      successCtx as never,
      {
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        storeId: "store_1",
      }
    );

    expect(successCtx.runMutation).toHaveBeenCalledWith(
      "auth.requestVerificationCode",
      {
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        storeId: "store_1",
      }
    );
    expect(successCtx.runQuery).toHaveBeenCalledWith("stores.findById", {
      id: "store_1",
    });
    expect(successResult).toEqual({
      success: true,
      message: "Verification code sent",
      data: {
        email: "ada@example.com",
      },
    });
  });
});

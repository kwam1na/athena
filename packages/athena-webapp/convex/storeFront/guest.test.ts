// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(
  definition: T
) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}
function h(fn: any): (...args: any[]) => any {
  return fn.handler;
}


function createDbHarness({
  queryQueues = {},
  records = {},
}: {
  queryQueues?: Record<string, any[]>;
  records?: Record<string, any>;
} = {}) {
  const queueMap = new Map<string, any[]>(
    Object.entries(queryQueues).map(([key, value]) => [key, [...value]])
  );
  const recordMap = new Map<string, any>(Object.entries(records));
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
    and: vi.fn((...values: boolean[]) => values.every(Boolean)),
    gte: vi.fn(() => true),
    lt: vi.fn(() => true),
  };
  const indexOps = {
    eq: vi.fn(() => indexOps),
  };

  const db = {
    query: vi.fn((table: string) => {
      const chain: any = {};
      chain.withIndex = vi.fn(
        (_name: string, callback?: (q: typeof indexOps) => unknown) => {
          if (callback) {
            callback(indexOps);
          }
          return chain;
        }
      );
      chain.filter = vi.fn((callback?: (q: typeof filterOps) => unknown) => {
        if (callback) {
          callback(filterOps);
        }
        return chain;
      });
      chain.collect = vi.fn(async () => take(`${table}:collect`) ?? []);
      chain.first = vi.fn(async () => take(`${table}:first`) ?? null);
      return chain;
    }),
    get: vi.fn(async (id: string) => recordMap.get(id) ?? null),
    insert: vi.fn(async (table: string, value: any) => {
      const id = `${table}_${++insertCounter}`;
      recordMap.set(id, { _id: id, ...value });
      return id;
    }),
    delete: vi.fn(async (id: string) => {
      recordMap.delete(id);
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
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));

  return import("./guest");
}

describe("storeFront guest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports basic guest CRUD flows", async () => {
    const mod = await loadModule();
    const { db, recordMap } = createDbHarness({
      queryQueues: {
        "guest:collect": [
          [{ _id: "guest_1", marker: "mk_1" }],
          [{ _id: "guest_2" }],
        ],
        "guest:first": [{ _id: "guest_1", marker: "mk_1" }],
      },
      records: {
        guest_1: { _id: "guest_1", marker: "mk_1" },
      },
    });

    const all = await h(mod.getAll)({ db } as never, {});
    expect(all).toEqual([{ _id: "guest_1", marker: "mk_1" }]);

    const byId = await h(mod.getById)({ db } as never, { id: "guest_1" });
    expect(byId).toEqual({ _id: "guest_1", marker: "mk_1" });

    const byMarker = await h(mod.getByMarker)({ db } as never, {
      marker: "mk_1",
    });
    expect(byMarker).toEqual({ _id: "guest_1", marker: "mk_1" });

    const created = await h(mod.create)({ db } as never, {
      marker: "mk_2",
      creationOrigin: "web",
      storeId: "store_1",
      organizationId: "org_1",
    });
    expect(created).toEqual(recordMap.get("guest_1"));

    const deleted = await h(mod.deleteGuest)({ db } as never, {
      id: "guest_1",
    });
    expect(deleted).toEqual({ message: "Guest deleted" });
  });

  it("updates only provided fields", async () => {
    const { update } = await loadModule();
    const { db, recordMap } = createDbHarness({
      records: {
        guest_3: { _id: "guest_3", marker: "mk_3" },
      },
    });

    const withFields = await h(update)({ db } as never, {
      id: "guest_3",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "5555551234",
    });

    expect(db.patch).toHaveBeenNthCalledWith(1, "guest_3", {
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "5555551234",
    });
    expect(withFields).toEqual(recordMap.get("guest_3"));

    await h(update)({ db } as never, {
      id: "guest_3",
      email: undefined,
      firstName: undefined,
      lastName: undefined,
      phoneNumber: undefined,
    });

    expect(db.patch).toHaveBeenNthCalledWith(2, "guest_3", {});
  });

  it("returns unique and returning visitor metrics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    const mod = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "guest:collect": [
          [{ _id: "guest_1" }, { _id: "guest_2" }],
          [{ _id: "guest_1" }],
        ],
        "analytics:collect": [
          [
            { storeFrontUserId: "guest_1" },
            { storeFrontUserId: "guest_2" },
            { storeFrontUserId: undefined },
          ],
        ],
        "analytics:first": [{ _id: "analytic_old_1" }, null],
      },
    });

    const uniqueForDay = await h(mod.getUniqueVisitorsForDay)(
      { db } as never,
      { storeId: "store_1" }
    );
    expect(uniqueForDay).toBe(2);

    const unique = await h(mod.getUniqueVisitors)({ db } as never, {
      storeId: "store_1",
    });
    expect(unique).toBe(1);

    const returning = await h(mod.getReturningVisitorsForDay)(
      { db } as never,
      { storeId: "store_1" }
    );
    expect(returning).toBe(1);

    vi.useRealTimers();
  });
});

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(
  definition: T
) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    query: wrapDefinition,
  }));

  return import("./users");
}

describe("users", () => {
  it("resolves all requested ids in order", async () => {
    const { getByIds } = await loadModule();

    const records = new Map<string, unknown>([
      ["guest_1", { _id: "guest_1", type: "guest" }],
      ["user_1", { _id: "user_1", type: "storeFrontUser" }],
    ]);

    const db = {
      get: vi.fn(async (id: string) => records.get(id) ?? null),
    };

    const result = await getByIds.handler({ db } as never, {
      ids: ["guest_1", "user_1"],
    });

    expect(db.get).toHaveBeenNthCalledWith(1, "guest_1");
    expect(db.get).toHaveBeenNthCalledWith(2, "user_1");
    expect(result).toEqual([
      { _id: "guest_1", type: "guest" },
      { _id: "user_1", type: "storeFrontUser" },
    ]);
  });
});

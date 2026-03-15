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
    mutation: wrapDefinition,
  }));

  return import("./supportTicket");
}

describe("supportTicket", () => {
  it("creates a support ticket and returns the created document", async () => {
    const { create } = await loadModule();

    const db = {
      insert: vi.fn().mockResolvedValue("ticket_1"),
      get: vi.fn().mockResolvedValue({
        _id: "ticket_1",
        storeId: "store_1",
        storeFrontUserId: "guest_1",
        origin: "checkout",
        checkoutSessionId: "session_1",
      }),
    };

    const result = await create.handler({ db } as never, {
      storeId: "store_1",
      storeFrontUserId: "guest_1",
      origin: "checkout",
      checkoutSessionId: "session_1",
    });

    expect(db.insert).toHaveBeenCalledWith("supportTicket", {
      storeId: "store_1",
      storeFrontUserId: "guest_1",
      origin: "checkout",
      checkoutSessionId: "session_1",
    });
    expect(db.get).toHaveBeenCalledWith("ticket_1");
    expect(result).toEqual({
      _id: "ticket_1",
      storeId: "store_1",
      storeFrontUserId: "guest_1",
      origin: "checkout",
      checkoutSessionId: "session_1",
    });
  });
});

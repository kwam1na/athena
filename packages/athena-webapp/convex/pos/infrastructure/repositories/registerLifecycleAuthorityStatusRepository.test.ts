import { describe, expect, it } from "vitest";

import { createRegisterLifecycleAuthorityStatusRepository } from "./registerLifecycleAuthorityStatusRepository";

describe("register lifecycle authority status repository", () => {
  it("upserts one latest acknowledgement row per terminal", async () => {
    const inserts: unknown[] = [];
    const patches: unknown[] = [];
    const replacements: unknown[] = [];
    const existing = {
      _id: "ack-1",
      cloudRegisterSessionId: "cloud-register-1",
      terminalId: "terminal-1",
    };
    const ctx = {
      db: {
        query() {
          return { withIndex() { return { async unique() { return existing; } }; } };
        },
        async insert(_table: string, value: unknown) { inserts.push(value); return "ack-2"; },
        async patch(_table: string, _id: string, value: unknown) { patches.push(value); },
        async replace(_table: string, _id: string, value: unknown) { replacements.push(value); },
      },
    };
    const repository = createRegisterLifecycleAuthorityStatusRepository(ctx as never);

    expect(await repository.getLatest("terminal-1" as never)).toBe(existing);
    await repository.upsertLatest("terminal-1" as never, {
      lifecycleRevision: 0,
      localRegisterSessionId: "local-register-1",
      mappingAuthorityRevision: 8,
      outcome: "repair_required",
      receivedAt: 2_000,
      storeId: "store-1",
    } as never);

    expect(inserts).toEqual([]);
    expect(patches).toEqual([]);
    expect(replacements).toEqual([
      {
        lifecycleRevision: 0,
        localRegisterSessionId: "local-register-1",
        mappingAuthorityRevision: 8,
        outcome: "repair_required",
        receivedAt: 2_000,
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    ]);
    expect(replacements[0]).not.toHaveProperty("cloudRegisterSessionId");
  });
});

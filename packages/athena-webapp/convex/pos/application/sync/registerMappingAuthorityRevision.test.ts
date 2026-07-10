import { describe, expect, it } from "vitest";

import {
  buildNextRegisterMappingAuthority,
  createPosLocalSyncMappingWithAuthority,
  markRegisterMappingAuthorityAmbiguous,
  markRegisterMappingAuthorityMapped,
} from "./registerMappingAuthorityRevision";

describe("register mapping authority revision", () => {
  it("advances on create, ambiguity, repair, and tombstone", () => {
    const mapped = buildNextRegisterMappingAuthority(null, {
      state: "mapped",
      cloudRegisterSessionId: "cloud-a",
    });
    expect(mapped).toMatchObject({ revision: 1, state: "mapped" });

    const ambiguous = buildNextRegisterMappingAuthority(mapped, {
      state: "ambiguous",
    });
    expect(ambiguous).toMatchObject({ revision: 2, state: "ambiguous" });

    const repaired = buildNextRegisterMappingAuthority(ambiguous, {
      state: "mapped",
      cloudRegisterSessionId: "cloud-b",
    });
    expect(repaired).toMatchObject({ revision: 3, state: "mapped" });

    const tombstoned = buildNextRegisterMappingAuthority(repaired, {
      state: "tombstoned",
    });
    expect(tombstoned).toMatchObject({ revision: 4, state: "tombstoned" });
  });

  it("does not advance an identical observation", () => {
    const current = {
      revision: 9,
      state: "mapped" as const,
      cloudRegisterSessionId: "cloud-a",
    };
    expect(
      buildNextRegisterMappingAuthority(current, {
        state: "mapped",
        cloudRegisterSessionId: "cloud-a",
      }),
    ).toBe(current);
  });

  it("creates a mapping and its authority row in the same writer boundary", async () => {
    const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
    const ctx = {
      db: {
        query(table: string) {
          return {
            withIndex() {
              return table === "posLocalSyncMapping"
                ? { async take() { return []; } }
                : { async unique() { return null; } };
            },
          };
        },
        async insert(table: string, value: Record<string, unknown>) {
          inserts.push({ table, value });
          return table === "posLocalSyncMapping" ? "mapping-1" : "authority-1";
        },
      },
    };

    await createPosLocalSyncMappingWithAuthority(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      localRegisterSessionId: "local-register-1",
      localEventId: "event-1",
      localIdKind: "registerSession",
      localId: "local-register-1",
      cloudTable: "registerSession",
      cloudId: "cloud-register-1",
      createdAt: 100,
    } as never);

    expect(inserts).toEqual([
      expect.objectContaining({ table: "posLocalSyncMapping" }),
      expect.objectContaining({
        table: "posRegisterMappingAuthority",
        value: expect.objectContaining({
          revision: 1,
          state: "mapped",
          cloudRegisterSessionId: "cloud-register-1",
        }),
      }),
    ]);
  });

  it("persists ambiguity as a higher revision", async () => {
    const patches: Record<string, unknown>[] = [];
    const current = {
      _id: "authority-1",
      revision: 3,
      state: "mapped",
      cloudRegisterSessionId: "cloud-register-1",
    };
    const ctx = {
      db: {
        query() {
          return { withIndex() { return { async unique() { return current; } }; } };
        },
        async patch(_table: string, _id: string, value: Record<string, unknown>) {
          patches.push(value);
        },
      },
    };

    await markRegisterMappingAuthorityAmbiguous(ctx as never, {
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      localRegisterSessionId: "local-register-1",
    });

    expect(patches).toEqual([
      expect.objectContaining({ revision: 4, state: "ambiguous" }),
    ]);
  });

  it("advances an ambiguous subject back to an exact mapped epoch", async () => {
    const patches: Record<string, unknown>[] = [];
    const current = {
      _id: "authority-1",
      revision: 4,
      state: "ambiguous",
    };
    const ctx = {
      db: {
        query() {
          return { withIndex() { return { async unique() { return current; } }; } };
        },
        async patch(_table: string, _id: string, value: Record<string, unknown>) {
          patches.push(value);
        },
      },
    };

    await markRegisterMappingAuthorityMapped(ctx as never, {
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "local-register-1",
      mappingId: "mapping-1" as never,
      sourceEventType: "repair",
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
    });

    expect(patches).toEqual([
      expect.objectContaining({
        cloudRegisterSessionId: "cloud-register-1",
        revision: 5,
        state: "mapped",
      }),
    ]);
  });
});

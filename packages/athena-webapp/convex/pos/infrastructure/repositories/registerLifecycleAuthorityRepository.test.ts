import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import { createRegisterLifecycleAuthorityRepository } from "./registerLifecycleAuthorityRepository";

describe("register lifecycle authority repository", () => {
  it("uses the exact terminal/local mapping index and caps ambiguity reads at two", async () => {
    const take = vi.fn(async () => [{ _id: "mapping-1" }, { _id: "mapping-2" }]);
    const eq = vi.fn(() => indexQuery);
    const indexQuery = { eq };
    const withIndex = vi.fn((_name, build) => {
      build(indexQuery);
      return { take };
    });
    const query = vi.fn(() => ({ withIndex }));
    const ctx = {
      db: { get: vi.fn(), normalizeId: vi.fn(), query },
    };
    const repository = createRegisterLifecycleAuthorityRepository(ctx as never);

    const result = await repository.listRegisterSessionMappings({
      localRegisterSessionId: "local-1",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toHaveLength(2);
    expect(query).toHaveBeenCalledWith("posLocalSyncMapping");
    expect(withIndex).toHaveBeenCalledWith(
      "by_store_terminal_localKindId",
      expect.any(Function),
    );
    expect(eq.mock.calls).toEqual([
      ["storeId", "store-1"],
      ["terminalId", "terminal-1"],
      ["localIdKind", "registerSession"],
      ["localId", "local-1"],
    ]);
    expect(take).toHaveBeenCalledWith(2);
  });

  it("normalizes and reads only the requested register session id", async () => {
    const get = vi.fn(async () => ({ _id: "cloud-1" }));
    const normalizeId = vi.fn(() => "cloud-1");
    const repository = createRegisterLifecycleAuthorityRepository({
      db: { get, normalizeId, query: vi.fn() },
    } as never);

    await expect(repository.getRegisterSession("cloud-1")).resolves.toEqual({
      _id: "cloud-1",
    });
    expect(normalizeId).toHaveBeenCalledWith("registerSession", "cloud-1");
    expect(get).toHaveBeenCalledWith("registerSession", "cloud-1");
  });

  it("reads mapping authority by exact terminal/local subject", async () => {
    const unique = vi.fn(async () => ({ revision: 7, state: "mapped" }));
    const eq = vi.fn(() => indexQuery);
    const indexQuery = { eq };
    const withIndex = vi.fn((_name, build) => {
      build(indexQuery);
      return { unique };
    });
    const repository = createRegisterLifecycleAuthorityRepository({
      db: {
        get: vi.fn(),
        normalizeId: vi.fn(),
        query: vi.fn(() => ({ withIndex })),
      },
    } as never);

    await expect(
      repository.getRegisterMappingAuthority({
        localRegisterSessionId: "local-1",
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toEqual({ revision: 7, state: "mapped" });
    expect(withIndex).toHaveBeenCalledWith(
      "by_store_terminal_localRegisterSession",
      expect.any(Function),
    );
    expect(eq.mock.calls).toEqual([
      ["storeId", "store-1"],
      ["terminalId", "terminal-1"],
      ["localRegisterSessionId", "local-1"],
    ]);
    expect(unique).toHaveBeenCalledTimes(1);
  });
});

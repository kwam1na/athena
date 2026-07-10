import { describe, expect, it, vi } from "vitest";

import { acknowledgeRegisterLifecycleAuthority } from "./registerLifecycleAuthority";

const input = {
  appVersion: " 1.2.3 ",
  buildSha: " abc123 ",
  cloudRegisterSessionId: "cloud-register-1",
  lifecycleRevision: 4,
  localRegisterSessionId: "local-register-1",
  mappingAuthorityRevision: 2,
  outcome: "applied" as const,
  rolloutCohort: "canary" as const,
  rolloutMode: "canary" as const,
  storeId: "store-1" as never,
  terminal: { _id: "terminal-1", storeId: "store-1" } as never,
};

describe("register lifecycle authority acknowledgement", () => {
  it("validates the exact server cursor and stores only redacted fields", async () => {
    const upsertLatest = vi.fn();
    const result = await acknowledgeRegisterLifecycleAuthority({} as never, input, {
      now: () => 100_000,
      getAuthority: vi.fn().mockResolvedValue({
        results: [{
          authorityCursor: { lifecycleRevision: 4, mappingAuthorityRevision: 2 },
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
        }],
      }),
      repository: { getLatest: vi.fn().mockResolvedValue(null), upsertLatest },
    });

    expect(result).toEqual({ status: "accepted", coalesced: false });
    expect(upsertLatest).toHaveBeenCalledWith(
      "terminal-1",
      expect.objectContaining({
        appVersion: "1.2.3",
        buildSha: "abc123",
        outcome: "applied",
        receivedAt: 100_000,
        rolloutCohort: "canary",
        rolloutMode: "canary",
      }),
    );
    expect(upsertLatest.mock.calls[0][1]).not.toHaveProperty("syncSecretHash");
    expect(upsertLatest.mock.calls[0][1]).not.toHaveProperty("message");
    expect(upsertLatest.mock.calls[0][1]).not.toHaveProperty("cashier");
    expect(upsertLatest.mock.calls[0][1]).not.toHaveProperty("indexedDb");
  });

  it("coalesces an equivalent acknowledgement within 30 seconds", async () => {
    const latest = {
      ...input,
      terminalId: "terminal-1",
      appVersion: "1.2.3",
      buildSha: "abc123",
      receivedAt: 90_001,
    };
    const upsertLatest = vi.fn();
    const result = await acknowledgeRegisterLifecycleAuthority({} as never, input, {
      now: () => 120_000,
      getAuthority: vi.fn().mockResolvedValue({
        results: [{
          authorityCursor: { lifecycleRevision: 4, mappingAuthorityRevision: 2 },
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
        }],
      }),
      repository: { getLatest: vi.fn().mockResolvedValue(latest), upsertLatest },
    });

    expect(result).toEqual({ status: "accepted", coalesced: true });
    expect(upsertLatest).not.toHaveBeenCalled();
  });

  it("rejects stale, cross-subject, or unsafe acknowledgements without writing", async () => {
    const upsertLatest = vi.fn();
    const dependencies = {
      now: () => 100,
      getAuthority: vi.fn().mockResolvedValue({
        results: [{
          authorityCursor: { lifecycleRevision: 5, mappingAuthorityRevision: 2 },
          cloudRegisterSessionId: "other-cloud-register",
          localRegisterSessionId: "local-register-1",
        }],
      }),
      repository: { getLatest: vi.fn(), upsertLatest },
    };

    await expect(
      acknowledgeRegisterLifecycleAuthority({} as never, input, dependencies),
    ).resolves.toEqual({ status: "rejected" });
    await expect(
      acknowledgeRegisterLifecycleAuthority(
        {} as never,
        { ...input, buildSha: "x".repeat(121) },
        dependencies,
      ),
    ).resolves.toEqual({ status: "rejected" });
    expect(upsertLatest).not.toHaveBeenCalled();
  });

  it("accepts redacted local-only repair evidence after cursor validation", async () => {
    const upsertLatest = vi.fn();
    const result = await acknowledgeRegisterLifecycleAuthority(
      {} as never,
      {
        ...input,
        cloudRegisterSessionId: undefined,
        lifecycleRevision: 0,
        mappingAuthorityRevision: 3,
        outcome: "repair_required",
      } as never,
      {
        now: () => 100_000,
        getAuthority: vi.fn().mockResolvedValue({
          results: [
            {
              authorityCursor: {
                lifecycleRevision: 0,
                mappingAuthorityRevision: 3,
              },
              classification: "repair_required",
              localRegisterSessionId: "local-register-1",
            },
          ],
        }),
        repository: {
          getLatest: vi.fn().mockResolvedValue(null),
          upsertLatest,
        },
      },
    );

    expect(result).toEqual({ status: "accepted", coalesced: false });
    expect(upsertLatest).toHaveBeenCalledWith(
      "terminal-1",
      expect.not.objectContaining({ cloudRegisterSessionId: expect.anything() }),
    );
  });
});

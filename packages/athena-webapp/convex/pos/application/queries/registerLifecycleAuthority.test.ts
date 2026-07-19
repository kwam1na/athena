import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import {
  compareRegisterLifecycleAuthorityCursors,
  getRegisterLifecycleAuthorityAcknowledgement,
  getRegisterLifecycleAuthority,
  getRegisterLifecycleAuthorityShadow,
  isValidRegisterLifecycleAuthorityCandidates,
  MAX_REGISTER_LIFECYCLE_AUTHORITY_CANDIDATES,
} from "./registerLifecycleAuthority";
import type { RegisterLifecycleAuthorityRepository } from "../../infrastructure/repositories/registerLifecycleAuthorityRepository";

const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;

describe("register lifecycle authority acknowledgement inspection", () => {
  it("returns only redacted latest evidence for the exact store and terminal", async () => {
    const record = {
      _id: "ack-1",
      _creationTime: 1,
      appVersion: "1.2.3",
      buildSha: "abc123",
      cloudRegisterSessionId: "cloud-register-1",
      lifecycleRevision: 4,
      localRegisterSessionId: "local-register-1",
      mappingAuthorityRevision: 2,
      outcome: "applied",
      receivedAt: 100,
      rolloutCohort: "canary",
      rolloutMode: "canary",
      storeId,
      terminalId,
    } as Doc<"posRegisterAuthorityReplicationStatus">;
    const repository = { getLatest: async () => record };

    await expect(
      getRegisterLifecycleAuthorityAcknowledgement(
        {} as never,
        { storeId, terminalId },
        repository,
      ),
    ).resolves.toEqual({
      appVersion: "1.2.3",
      buildSha: "abc123",
      cloudRegisterSessionId: "cloud-register-1",
      lifecycleRevision: 4,
      localRegisterSessionId: "local-register-1",
      mappingAuthorityRevision: 2,
      outcome: "applied",
      receivedAt: 100,
      rolloutCohort: "canary",
      rolloutMode: "canary",
      terminalId,
    });
    expect(
      JSON.stringify(
        await getRegisterLifecycleAuthorityAcknowledgement(
          {} as never,
          { storeId, terminalId },
          repository,
        ),
      ),
    ).not.toMatch(/secret|cashier|payload|staff/i);
    await expect(
      getRegisterLifecycleAuthorityAcknowledgement(
        {} as never,
        { storeId: "store-2" as Id<"store">, terminalId },
        repository,
      ),
    ).resolves.toBeNull();
  });
});

describe("register lifecycle authority shadow query", () => {
  it("classifies only exact terminal mappings without mutating cloud state", async () => {
    const repository = createRepository({
      mappings: {
        "local-active": [mapping("local-active", "cloud-active")],
        "local-closed": [mapping("local-closed", "cloud-closed")],
        "local-ambiguous": [
          mapping("local-ambiguous", "cloud-active"),
          mapping("local-ambiguous", "cloud-closed"),
        ],
      },
      sessions: {
        "cloud-active": registerSession("cloud-active", "active"),
        "cloud-closed": registerSession("cloud-closed", "closed"),
      },
    });

    const result = await getRegisterLifecycleAuthorityShadow(
      {} as never,
      {
        candidates: [
          { localRegisterSessionId: "local-active" },
          {
            cloudRegisterSessionId: "cloud-closed",
            localRegisterSessionId: "local-closed",
          },
          { localRegisterSessionId: "local-unmapped" },
          { localRegisterSessionId: "local-ambiguous" },
        ],
        storeId,
        terminal: terminal(),
      },
      repository,
    );

    expect(result).toEqual({
      candidateCount: 4,
      maximumDocumentReads: 9,
      mode: "shadow",
      results: [
        {
          classification: "sale_usable",
          cloudRegisterSessionId: "cloud-active",
          cloudStatus: "active",
          localRegisterSessionId: "local-active",
        },
        {
          classification: "sale_blocked",
          cloudRegisterSessionId: "cloud-closed",
          cloudStatus: "closed",
          localRegisterSessionId: "local-closed",
        },
        {
          classification: "unmapped",
          localRegisterSessionId: "local-unmapped",
        },
        {
          classification: "repair_required",
          localRegisterSessionId: "local-ambiguous",
        },
      ],
    });
    expect("write" in repository).toBe(false);
  });

  it("keeps the 16-candidate worst case below 40 document reads", async () => {
    const mappings: Record<string, Doc<"posLocalSyncMapping">[]> = {};
    const sessions: Record<string, Doc<"registerSession">> = {};
    const candidates = Array.from(
      { length: MAX_REGISTER_LIFECYCLE_AUTHORITY_CANDIDATES },
      (_, index) => {
        const localId = `local-${index}`;
        const cloudId = `cloud-${index}`;
        mappings[localId] = [mapping(localId, cloudId)];
        sessions[cloudId] = registerSession(cloudId, "active");
        return { localRegisterSessionId: localId };
      },
    );
    const repository = createRepository({ mappings, sessions });

    const result = await getRegisterLifecycleAuthorityShadow(
      {} as never,
      { candidates, storeId, terminal: terminal() },
      repository,
    );

    expect(result.maximumDocumentReads).toBe(33);
    expect(result.maximumDocumentReads).toBeLessThanOrEqual(40);
    expect(repository.reads()).toBe(32);
    expect(result.results).toHaveLength(16);
  });

  it("redacts foreign or mismatched mapping details as repair required", async () => {
    const repository = createRepository({
      mappings: {
        "local-1": [mapping("local-1", "cloud-1")],
      },
      sessions: {
        "cloud-1": registerSession("cloud-1", "active", {
          storeId: "store-foreign" as Id<"store">,
        }),
      },
    });

    const result = await getRegisterLifecycleAuthorityShadow(
      {} as never,
      {
        candidates: [
          {
            cloudRegisterSessionId: "cloud-1",
            localRegisterSessionId: "local-1",
          },
        ],
        storeId,
        terminal: terminal(),
      },
      repository,
    );

    expect(result.results).toEqual([
      {
        classification: "repair_required",
        localRegisterSessionId: "local-1",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("store-foreign");
    expect(JSON.stringify(result)).not.toContain("cloud-1");
  });

  it("recomputes the same exact subject when cloud lifecycle changes", async () => {
    const sessions: Record<string, Doc<"registerSession">> = {
      "cloud-1": registerSession("cloud-1", "active"),
    };
    const repository = createRepository({
      mappings: { "local-1": [mapping("local-1", "cloud-1")] },
      sessions,
    });
    const args = {
      candidates: [{ localRegisterSessionId: "local-1" }],
      storeId,
      terminal: terminal(),
    };

    await expect(
      getRegisterLifecycleAuthorityShadow({} as never, args, repository),
    ).resolves.toMatchObject({
      results: [{ classification: "sale_usable", cloudStatus: "active" }],
    });

    sessions["cloud-1"] = registerSession("cloud-1", "closed");

    await expect(
      getRegisterLifecycleAuthorityShadow({} as never, args, repository),
    ).resolves.toMatchObject({
      results: [{ classification: "sale_blocked", cloudStatus: "closed" }],
    });
  });

  it("rejects duplicate, oversized, overlength, and malformed candidates", () => {
    expect(
      isValidRegisterLifecycleAuthorityCandidates([
        { localRegisterSessionId: "local-1" },
        { localRegisterSessionId: "local-1" },
      ]),
    ).toBe(false);
    expect(
      isValidRegisterLifecycleAuthorityCandidates(
        Array.from({ length: 17 }, (_, index) => ({
          localRegisterSessionId: `local-${index}`,
        })),
      ),
    ).toBe(false);
    expect(
      isValidRegisterLifecycleAuthorityCandidates([
        { localRegisterSessionId: "x".repeat(121) },
      ]),
    ).toBe(false);
    expect(
      isValidRegisterLifecycleAuthorityCandidates([
        { localRegisterSessionId: " local-1" },
      ]),
    ).toBe(false);
    expect(
      isValidRegisterLifecycleAuthorityCandidates([
        {
          cloudRegisterSessionId: "cloud-1",
          localRegisterSessionId: "local-1",
        },
      ]),
    ).toBe(true);
  });
});

describe("versioned register lifecycle authority query", () => {
  it("distinguishes a claimed missing cloud session from a local-only unmapped drawer", async () => {
    const repository = createRepository({
      sessions: {
        "cloud-existing": registerSession("cloud-existing", "active"),
      },
    });

    const result = await getRegisterLifecycleAuthority(
      {} as never,
      {
        candidates: [
          {
            cloudRegisterSessionId: "cloud-missing",
            localRegisterSessionId: "local-stale",
          },
          { localRegisterSessionId: "local-only" },
          {
            cloudRegisterSessionId: "cloud-existing",
            localRegisterSessionId: "local-needs-repair",
          },
        ],
        storeId,
        terminal: terminal(),
      },
      repository,
    );

    expect(result.results).toEqual([
      {
        authorityCursor: {
          lifecycleRevision: 0,
          mappingAuthorityRevision: 0,
        },
        classification: "stale_cloud_subject",
        cloudRegisterSessionId: "cloud-missing",
        lifecycleRevision: 0,
        localRegisterSessionId: "local-stale",
        mappingAuthorityRevision: 0,
      },
      {
        authorityCursor: {
          lifecycleRevision: 0,
          mappingAuthorityRevision: 0,
        },
        classification: "unmapped",
        lifecycleRevision: 0,
        localRegisterSessionId: "local-only",
        mappingAuthorityRevision: 0,
      },
      {
        authorityCursor: {
          lifecycleRevision: 0,
          mappingAuthorityRevision: 0,
        },
        classification: "repair_required",
        lifecycleRevision: 0,
        localRegisterSessionId: "local-needs-repair",
        mappingAuthorityRevision: 0,
      },
    ]);
  });

  it("returns versioned exact authority and baseline-zero legacy authority", async () => {
    const repository = createRepository({
      authorities: {
        "local-active": mappingAuthority("local-active", 7, {
          cloudRegisterSessionId: "cloud-active",
          state: "mapped",
        }),
      },
      mappings: {
        "local-closed": [mapping("local-closed", "cloud-closed")],
      },
      sessions: {
        "cloud-active": registerSession("cloud-active", "active", {
          lifecycleAuthorityRevision: 11,
        }),
        "cloud-closed": registerSession("cloud-closed", "closed"),
      },
    });

    const result = await getRegisterLifecycleAuthority(
      {} as never,
      {
        candidates: [
          { localRegisterSessionId: "local-active" },
          { localRegisterSessionId: "local-closed" },
        ],
        storeId,
        terminal: terminal(),
      },
      repository,
    );

    expect(result).toEqual({
      candidateCount: 2,
      maximumDocumentReads: 5,
      results: [
        {
          authorityCursor: {
            lifecycleRevision: 11,
            mappingAuthorityRevision: 7,
          },
          classification: "sale_usable",
          cloudRegisterSessionId: "cloud-active",
          cloudStatus: "active",
          lifecycleRevision: 11,
          localRegisterSessionId: "local-active",
          mappingAuthorityRevision: 7,
        },
        {
          authorityCursor: {
            lifecycleRevision: 0,
            mappingAuthorityRevision: 0,
          },
          classification: "sale_blocked",
          cloudRegisterSessionId: "cloud-closed",
          cloudStatus: "closed",
          lifecycleRevision: 0,
          localRegisterSessionId: "local-closed",
          mappingAuthorityRevision: 0,
        },
      ],
    });
  });

  it("returns the terminal active session when local authority has no candidates", async () => {
    const repository = createRepository({
      sessions: {
        "cloud-active": registerSession("cloud-active", "active", {
          expectedCash: 35000,
          lifecycleAuthorityRevision: 3,
          openedAt: 200,
          openedByStaffProfileId: "staff-manager" as Id<"staffProfile">,
          openingFloat: 30000,
        }),
      },
      terminalSessions: {
        active: [
          registerSession("cloud-active", "active", {
            expectedCash: 35000,
            lifecycleAuthorityRevision: 3,
            openedAt: 200,
            openedByStaffProfileId: "staff-manager" as Id<"staffProfile">,
            openingFloat: 30000,
          }),
        ],
      },
    });

    await expect(
      getRegisterLifecycleAuthority(
        {} as never,
        { candidates: [], storeId, terminal: terminal() },
        repository,
      ),
    ).resolves.toEqual({
      bootstrap: {
        authorityCursor: {
          lifecycleRevision: 3,
          mappingAuthorityRevision: 0,
        },
        classification: "sale_usable",
        cloudRegisterSessionId: "cloud-active",
        cloudStatus: "active",
        expectedCash: 35000,
        lifecycleRevision: 3,
        localRegisterSessionId: "cloud-active",
        mappingAuthorityRevision: 0,
        openedAt: 200,
        openingFloat: 30000,
        registerNumber: "1",
        staffProfileId: "staff-manager",
      },
      candidateCount: 0,
      maximumDocumentReads: 3,
      results: [],
    });
  });

  it("keeps an exact server bootstrap identity authoritative without a sync mapping", async () => {
    const bootstrapSession = registerSession("cloud-bootstrap", "active", {
      lifecycleAuthorityRevision: 3,
    });
    const repository = createRepository({
      sessions: { "cloud-bootstrap": bootstrapSession },
      terminalSessions: { active: [bootstrapSession] },
    });

    const bootstrap = await getRegisterLifecycleAuthority(
      {} as never,
      { candidates: [], storeId, terminal: terminal() },
      repository,
    );
    const bootstrappedIdentity = bootstrap.bootstrap;
    expect(bootstrappedIdentity).toBeDefined();

    await expect(
      getRegisterLifecycleAuthority(
        {} as never,
        {
          candidates: [
            {
              cloudRegisterSessionId:
                bootstrappedIdentity!.cloudRegisterSessionId,
              localRegisterSessionId:
                bootstrappedIdentity!.localRegisterSessionId,
            },
          ],
          storeId,
          terminal: terminal(),
        },
        repository,
      ),
    ).resolves.toMatchObject({
      results: [
        {
          classification: "sale_usable",
          cloudRegisterSessionId: "cloud-bootstrap",
          cloudStatus: "active",
          lifecycleRevision: 3,
          localRegisterSessionId: "cloud-bootstrap",
          mappingAuthorityRevision: 0,
        },
      ],
    });
  });

  it("keeps a mismatched exact-id claim behind the repair boundary", async () => {
    const repository = createRepository({
      sessions: {
        "cloud-foreign": registerSession("cloud-foreign", "active", {
          terminalId: "terminal-foreign" as Id<"posTerminal">,
        }),
      },
    });

    await expect(
      getRegisterLifecycleAuthority(
        {} as never,
        {
          candidates: [
            {
              cloudRegisterSessionId: "cloud-foreign",
              localRegisterSessionId: "cloud-foreign",
            },
          ],
          storeId,
          terminal: terminal(),
        },
        repository,
      ),
    ).resolves.toMatchObject({
      results: [
        {
          classification: "repair_required",
          localRegisterSessionId: "cloud-foreign",
        },
      ],
    });
  });

  it("tombstones an exact versioned mapping whose cloud session disappeared", async () => {
    const repository = createRepository({
      authorities: {
        "cloud-missing": mappingAuthority("cloud-missing", 6, {
          cloudRegisterSessionId: "cloud-missing",
          state: "mapped",
        }),
      },
    });

    await expect(
      getRegisterLifecycleAuthority(
        {} as never,
        {
          candidates: [
            {
              cloudRegisterSessionId: "cloud-missing",
              localRegisterSessionId: "cloud-missing",
            },
          ],
          storeId,
          terminal: terminal(),
        },
        repository,
      ),
    ).resolves.toMatchObject({
      results: [
        {
          classification: "stale_cloud_subject",
          cloudRegisterSessionId: "cloud-missing",
          lifecycleRevision: 0,
          localRegisterSessionId: "cloud-missing",
          mappingAuthorityRevision: 6,
        },
      ],
    });
  });

  it("orders mapping epochs before lifecycle revisions", () => {
    expect(
      compareRegisterLifecycleAuthorityCursors(
        { mappingAuthorityRevision: 2, lifecycleRevision: 1 },
        { mappingAuthorityRevision: 1, lifecycleRevision: 99 },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareRegisterLifecycleAuthorityCursors(
        { mappingAuthorityRevision: 2, lifecycleRevision: 3 },
        { mappingAuthorityRevision: 2, lifecycleRevision: 4 },
      ),
    ).toBeLessThan(0);
  });

  it("redacts ambiguous and foreign authority subjects", async () => {
    const repository = createRepository({
      authorities: {
        "local-ambiguous": mappingAuthority("local-ambiguous", 8, {
          state: "ambiguous",
        }),
        "local-foreign": mappingAuthority("local-foreign", 9, {
          cloudRegisterSessionId: "cloud-foreign",
          state: "mapped",
        }),
      },
      sessions: {
        "cloud-foreign": registerSession("cloud-foreign", "active", {
          lifecycleAuthorityRevision: 30,
          storeId: "store-foreign" as Id<"store">,
        }),
      },
    });

    const result = await getRegisterLifecycleAuthority(
      {} as never,
      {
        candidates: [
          { localRegisterSessionId: "local-ambiguous" },
          { localRegisterSessionId: "local-foreign" },
        ],
        storeId,
        terminal: terminal(),
      },
      repository,
    );

    expect(result.results).toEqual([
      {
        authorityCursor: {
          lifecycleRevision: 0,
          mappingAuthorityRevision: 8,
        },
        classification: "repair_required",
        lifecycleRevision: 0,
        localRegisterSessionId: "local-ambiguous",
        mappingAuthorityRevision: 8,
      },
      {
        authorityCursor: {
          lifecycleRevision: 0,
          mappingAuthorityRevision: 9,
        },
        classification: "repair_required",
        lifecycleRevision: 0,
        localRegisterSessionId: "local-foreign",
        mappingAuthorityRevision: 9,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("cloud-foreign");
    expect(JSON.stringify(result)).not.toContain("store-foreign");
    expect(JSON.stringify(result)).not.toContain("30");
  });

  it("keeps mixed versioned and legacy candidates within 33 reads", async () => {
    const authorities: Record<string, Doc<"posRegisterMappingAuthority">> = {};
    const mappings: Record<string, Doc<"posLocalSyncMapping">[]> = {};
    const sessions: Record<string, Doc<"registerSession">> = {};
    const candidates = Array.from({ length: 16 }, (_, index) => {
      const localId = `local-${index}`;
      const cloudId = `cloud-${index}`;
      if (index % 2 === 0) {
        authorities[localId] = mappingAuthority(localId, index + 1, {
          cloudRegisterSessionId: cloudId,
          state: "mapped",
        });
      } else {
        mappings[localId] = [mapping(localId, cloudId)];
      }
      sessions[cloudId] = registerSession(cloudId, "active");
      return { localRegisterSessionId: localId };
    });
    const repository = createRepository({ authorities, mappings, sessions });

    const result = await getRegisterLifecycleAuthority(
      {} as never,
      { candidates, storeId, terminal: terminal() },
      repository,
    );

    expect(result.maximumDocumentReads).toBe(33);
    expect(result.maximumDocumentReads).toBeLessThanOrEqual(40);
    expect(repository.reads()).toBe(32);
  });
});

function createRepository(input: {
  authorities?: Record<string, Doc<"posRegisterMappingAuthority">>;
  mappings?: Record<string, Doc<"posLocalSyncMapping">[]>;
  sessions?: Record<string, Doc<"registerSession">>;
  terminalSessions?: Partial<
    Record<"active" | "open", Doc<"registerSession">[]>
  >;
}) {
  let readCount = 0;
  return {
    async getRegisterMappingAuthority(args) {
      const row = input.authorities?.[args.localRegisterSessionId] ?? null;
      if (row) readCount += 1;
      return row;
    },
    async listRegisterSessionMappings(args) {
      const rows = input.mappings?.[args.localRegisterSessionId] ?? [];
      readCount += rows.length;
      return rows;
    },
    async getRegisterSession(cloudRegisterSessionId) {
      readCount += 1;
      return input.sessions?.[cloudRegisterSessionId] ?? null;
    },
    async listSaleUsableRegisterSessions(args) {
      const rows = input.terminalSessions?.[args.status] ?? [];
      readCount += rows.length;
      return rows;
    },
    reads: () => readCount,
  } satisfies RegisterLifecycleAuthorityRepository & { reads(): number };
}

function mappingAuthority(
  localRegisterSessionId: string,
  revision: number,
  overrides: Partial<Doc<"posRegisterMappingAuthority">>,
): Doc<"posRegisterMappingAuthority"> {
  return {
    _creationTime: 1,
    _id: `authority-${localRegisterSessionId}` as Id<"posRegisterMappingAuthority">,
    localRegisterSessionId,
    revision,
    state: "mapped",
    storeId,
    terminalId,
    updatedAt: 1,
    ...overrides,
  };
}

function terminal(): Doc<"posTerminal"> {
  return {
    _creationTime: 1,
    _id: terminalId,
    browserInfo: { userAgent: "test" },
    displayName: "Front",
    fingerprintHash: "fingerprint",
    registerNumber: "1",
    registeredAt: 1,
    registeredByUserId: "user-1" as Id<"athenaUser">,
    status: "active",
    storeId,
  };
}

function mapping(
  localRegisterSessionId: string,
  cloudRegisterSessionId: string,
): Doc<"posLocalSyncMapping"> {
  return {
    _creationTime: 1,
    _id: `mapping-${localRegisterSessionId}-${cloudRegisterSessionId}` as Id<"posLocalSyncMapping">,
    cloudId: cloudRegisterSessionId,
    cloudTable: "registerSession",
    createdAt: 1,
    localEventId: `event-${localRegisterSessionId}`,
    localId: localRegisterSessionId,
    localIdKind: "registerSession",
    localRegisterSessionId,
    storeId,
    terminalId,
  };
}

function registerSession(
  id: string,
  status: Doc<"registerSession">["status"],
  overrides: Partial<Doc<"registerSession">> = {},
): Doc<"registerSession"> {
  return {
    _creationTime: 1,
    _id: id as Id<"registerSession">,
    expectedCash: 100,
    openedAt: 1,
    openingFloat: 100,
    registerNumber: "1",
    status,
    storeId,
    terminalId,
    ...overrides,
  };
}

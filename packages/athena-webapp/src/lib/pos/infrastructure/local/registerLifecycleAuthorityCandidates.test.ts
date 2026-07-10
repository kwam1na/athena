import { describe, expect, it } from "vitest";

import { deriveRegisterLifecycleAuthorityCandidates } from "./registerLifecycleAuthorityCandidates";

function mapping(
  localId: string,
  cloudId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    cloudId,
    entity: "registerSession" as const,
    localId,
    mappedAt: 1_000,
    registerCandidateState: "current" as const,
    registerNumber: "2",
    storeId: "store-1",
    terminalId: "local-terminal-1",
    ...overrides,
  };
}

function openedEvent(localRegisterSessionId: string, syncStatus = "pending") {
  return {
    localRegisterSessionId,
    payload: { localRegisterSessionId },
    sync: { status: syncStatus },
    type: "register.opened",
  };
}

const scope = {
  registerNumber: "2",
  storeId: "store-1",
  terminalId: "local-terminal-1",
};

describe("deriveRegisterLifecycleAuthorityCandidates", () => {
  it("prioritizes the projected drawer, pending replacement, and exact current mapping", () => {
    const result = deriveRegisterLifecycleAuthorityCandidates({
      ...scope,
      projection: {
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-active",
          localRegisterSessionId: "local-active",
        },
        mappings: [mapping("local-mapped", "cloud-mapped")],
        sourceEvents: [openedEvent("local-pending")],
      },
    });

    expect(result).toEqual({
      candidates: [
        {
          cloudRegisterSessionId: "cloud-active",
          localRegisterSessionId: "local-active",
        },
        { localRegisterSessionId: "local-pending" },
        {
          cloudRegisterSessionId: "cloud-mapped",
          expectedMapping: {
            cloudRegisterSessionId: "cloud-mapped",
            mappedAt: 1_000,
            mappingAuthorityRevision: undefined,
            registerCandidateState: "current",
            registerNumber: "2",
            storeId: "store-1",
            terminalId: "local-terminal-1",
          },
          localRegisterSessionId: "local-mapped",
        },
      ],
      status: "ready",
    });
  });

  it("fails closed instead of selecting the newest legacy mapping", () => {
    const result = deriveRegisterLifecycleAuthorityCandidates({
      ...scope,
      projection: {
        activeRegisterSession: null,
        mappings: [
          mapping("local-old", "cloud-old", {
            mappedAt: 1_000,
            registerCandidateState: undefined,
          }),
          mapping("local-new", "cloud-new", {
            mappedAt: 2_000,
            registerCandidateState: undefined,
          }),
        ],
        sourceEvents: [],
      },
    });

    expect(result).toEqual({ reason: "ambiguous", status: "invalid" });
  });

  it("fails closed for one unscoped legacy mapping", () => {
    expect(
      deriveRegisterLifecycleAuthorityCandidates({
        ...scope,
        projection: {
          activeRegisterSession: null,
          mappings: [
            mapping("local-legacy", "cloud-legacy", {
              registerCandidateState: undefined,
              registerNumber: undefined,
              storeId: undefined,
              terminalId: undefined,
            }),
          ],
          sourceEvents: [],
        },
      }),
    ).toEqual({ reason: "ambiguous", status: "invalid" });
  });

  it("keeps an exact scoped current mapping reachable after event history is compacted", () => {
    expect(
      deriveRegisterLifecycleAuthorityCandidates({
        ...scope,
        projection: {
          activeRegisterSession: null,
          mappings: [mapping("local-current", "cloud-current")],
          sourceEvents: [],
        },
      }),
    ).toMatchObject({
      candidates: [
        {
          cloudRegisterSessionId: "cloud-current",
          localRegisterSessionId: "local-current",
        },
      ],
      status: "ready",
    });
  });

  it("ignores exact current mappings owned by another store or terminal", () => {
    expect(
      deriveRegisterLifecycleAuthorityCandidates({
        ...scope,
        projection: {
          activeRegisterSession: null,
          mappings: [
            mapping("local-store", "cloud-store", { storeId: "store-2" }),
            mapping("local-terminal", "cloud-terminal", {
              terminalId: "local-terminal-2",
            }),
            mapping("local-current", "cloud-current"),
          ],
          sourceEvents: [],
        },
      }),
    ).toMatchObject({
      candidates: [
        {
          cloudRegisterSessionId: "cloud-current",
          localRegisterSessionId: "local-current",
        },
      ],
      status: "ready",
    });
  });

  it("fails closed for ambiguous legacy selection or conflicting cloud provenance", () => {
    expect(
      deriveRegisterLifecycleAuthorityCandidates({
        ...scope,
        projection: {
          activeRegisterSession: null,
          mappings: [
            mapping("local-a", "cloud-a", {
              mappedAt: 2_000,
              registerCandidateState: undefined,
            }),
            mapping("local-b", "cloud-b", {
              mappedAt: 2_000,
              registerCandidateState: undefined,
            }),
          ],
          sourceEvents: [],
        },
      }),
    ).toEqual({ reason: "ambiguous", status: "invalid" });

    expect(
      deriveRegisterLifecycleAuthorityCandidates({
        ...scope,
        projection: {
          activeRegisterSession: null,
          mappings: [
            mapping("local-current-a", "cloud-current-a"),
            mapping("local-current-b", "cloud-current-b"),
          ],
          sourceEvents: [],
        },
      }),
    ).toEqual({ reason: "ambiguous", status: "invalid" });

    expect(
      deriveRegisterLifecycleAuthorityCandidates({
        ...scope,
        projection: {
          activeRegisterSession: {
            cloudRegisterSessionId: "cloud-a",
            localRegisterSessionId: "local-a",
          },
          mappings: [mapping("local-a", "cloud-b")],
          sourceEvents: [],
        },
      }),
    ).toEqual({ reason: "ambiguous", status: "invalid" });
  });

  it("fails closed instead of truncating overflow or malformed identifiers", () => {
    expect(
      deriveRegisterLifecycleAuthorityCandidates({
        ...scope,
        projection: {
          activeRegisterSession: null,
          mappings: [],
          sourceEvents: Array.from({ length: 17 }, (_, index) =>
            openedEvent(`local-${index}`),
          ),
        },
      }),
    ).toEqual({ reason: "overflow", status: "invalid" });

    expect(
      deriveRegisterLifecycleAuthorityCandidates({
        ...scope,
        projection: {
          activeRegisterSession: {
            localRegisterSessionId: "x".repeat(121),
          },
          mappings: [],
          sourceEvents: [],
        },
      }),
    ).toEqual({ reason: "malformed", status: "invalid" });
  });

  it("ignores historical, foreign-scope, and already-synced historical opens", () => {
    const result = deriveRegisterLifecycleAuthorityCandidates({
      ...scope,
      projection: {
        activeRegisterSession: null,
        mappings: [
          mapping("local-historical", "cloud-historical", {
            registerCandidateState: "historical",
          }),
          mapping("local-foreign", "cloud-foreign", {
            terminalId: "other-terminal",
          }),
        ],
        sourceEvents: [openedEvent("local-synced", "synced")],
      },
    });

    expect(result).toEqual({ candidates: [], status: "empty" });
  });
});

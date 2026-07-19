import { describe, expect, it } from "vitest";

import {
  reconcileRegisterLifecycleServerAuthority,
  type PosRegisterLifecycleServerAuthority,
} from "./registerLifecycleAuthorityReconciliation";

function versioned(
  overrides: Partial<PosRegisterLifecycleServerAuthority> = {},
): PosRegisterLifecycleServerAuthority {
  return {
    classification: "sale_blocked",
    cloudRegisterSessionId: "cloud-register-1",
    cursor: {
      lifecycleRevision: 1,
      mappingAuthorityRevision: 1,
    },
    observedAt: 100,
    reason: "cloud_closed",
    source: "dedicated_snapshot",
    status: "blocked",
    ...overrides,
  };
}

describe("reconcileRegisterLifecycleServerAuthority", () => {
  it("orders mapping authority before lifecycle revision in both directions", () => {
    const oldMappingHighLifecycle = versioned({
      cursor: {
        lifecycleRevision: 99,
        mappingAuthorityRevision: 4,
      },
    });
    const newMappingLowLifecycle = versioned({
      classification: "sale_usable",
      cursor: {
        lifecycleRevision: 1,
        mappingAuthorityRevision: 5,
      },
      reason: undefined,
      status: "healthy",
    });

    expect(
      reconcileRegisterLifecycleServerAuthority(
        oldMappingHighLifecycle,
        newMappingLowLifecycle,
      ),
    ).toMatchObject({ disposition: "applied", value: newMappingLowLifecycle });
    expect(
      reconcileRegisterLifecycleServerAuthority(
        newMappingLowLifecycle,
        oldMappingHighLifecycle,
      ),
    ).toEqual({ disposition: "noop", reason: "stale" });
  });

  it("rejects a different cloud subject at the same mapping epoch", () => {
    expect(
      reconcileRegisterLifecycleServerAuthority(
        versioned(),
        versioned({ cloudRegisterSessionId: "cloud-register-2" }),
      ),
    ).toEqual({ disposition: "rejected", reason: "cursor_conflict" });
  });

  it("applies an exact stale-cloud tombstone without relaxing subject conflicts", () => {
    const current = versioned({
      classification: "sale_usable",
      reason: undefined,
      status: "healthy",
    });
    const staleCloudSubject = versioned({
      classification: "stale_cloud_subject",
      reason: "authority_unknown",
      status: "blocked",
    });

    expect(
      reconcileRegisterLifecycleServerAuthority(
        current,
        staleCloudSubject,
      ),
    ).toMatchObject({
      disposition: "applied",
      value: staleCloudSubject,
    });
    expect(
      reconcileRegisterLifecycleServerAuthority(
        current,
        {
          ...staleCloudSubject,
          cloudRegisterSessionId: "cloud-register-2",
        },
      ),
    ).toEqual({ disposition: "rejected", reason: "cursor_conflict" });
  });

  it("treats equal cursors and payloads as duplicate but conflicting payloads as invalid", () => {
    const current = versioned();
    expect(
      reconcileRegisterLifecycleServerAuthority(current, {
        ...current,
        observedAt: 500,
      }),
    ).toEqual({ disposition: "noop", reason: "duplicate" });
    expect(
      reconcileRegisterLifecycleServerAuthority(current, {
        ...current,
        classification: "sale_usable",
        reason: undefined,
        status: "healthy",
      }),
    ).toEqual({ disposition: "rejected", reason: "cursor_conflict" });
  });

  it("never lets an unversioned legacy directive overwrite dedicated authority", () => {
    expect(
      reconcileRegisterLifecycleServerAuthority(versioned(), {
        classification: "sale_blocked",
        cloudRegisterSessionId: "cloud-register-1",
        observedAt: 999,
        reason: "cloud_closed",
        source: "legacy_runtime_directive",
        status: "blocked",
      }),
    ).toEqual({ disposition: "noop", reason: "lower_confidence" });
  });

  it("rejects a dedicated observation without a valid durable cursor", () => {
    expect(
      reconcileRegisterLifecycleServerAuthority(null, {
        classification: "sale_blocked",
        cloudRegisterSessionId: "cloud-register-1",
        observedAt: 999,
        reason: "cloud_closed",
        source: "dedicated_snapshot",
        status: "blocked",
      }),
    ).toEqual({ disposition: "rejected", reason: "cursor_conflict" });
  });
});

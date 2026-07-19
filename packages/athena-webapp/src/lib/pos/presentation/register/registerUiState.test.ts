import { describe, expect, it } from "vitest";

import {
  buildRegisterOperationalIdleState,
  buildRegisterUpdateApplyBlockerState,
  hasBlockingAuthorityPersistenceFailure,
} from "./registerUiState";

describe("hasBlockingAuthorityPersistenceFailure", () => {
  it("never blocks when persistence has not failed", () => {
    for (const status of ["idle", "applying", "ready"] as const) {
      expect(
        hasBlockingAuthorityPersistenceFailure({
          hasPendingOptimisticDrawerOpen: true,
          status,
        }),
      ).toBe(false);
    }
  });

  it("suppresses the transient candidate_invalid failure while a drawer open is pending", () => {
    // The flash case: replacement drawer just opened, read model not yet settled.
    expect(
      hasBlockingAuthorityPersistenceFailure({
        hasPendingOptimisticDrawerOpen: true,
        reason: "candidate_invalid",
        status: "failed",
      }),
    ).toBe(false);
  });

  it("surfaces candidate_invalid once the open has settled", () => {
    expect(
      hasBlockingAuthorityPersistenceFailure({
        hasPendingOptimisticDrawerOpen: false,
        reason: "candidate_invalid",
        status: "failed",
      }),
    ).toBe(true);
  });

  it("never suppresses genuine persistence failures, even during a pending open", () => {
    for (const reason of [
      "write_failed",
      "snapshot_invalid",
      "mapping_invalidated",
    ] as const) {
      expect(
        hasBlockingAuthorityPersistenceFailure({
          hasPendingOptimisticDrawerOpen: true,
          reason,
          status: "failed",
        }),
      ).toBe(true);
    }
  });

  it("blocks a failure with no reason", () => {
    expect(
      hasBlockingAuthorityPersistenceFailure({
        hasPendingOptimisticDrawerOpen: true,
        status: "failed",
      }),
    ).toBe(true);
  });
});

describe("buildRegisterOperationalIdleState", () => {
  it.each([
    ["active sale work", { hasActiveSaleWork: true }],
    ["checkout work", { hasCheckoutMutationInFlight: true }],
    ["a drawer transition", { hasDrawerTransitionInFlight: true }],
    ["local persistence risk", { hasLocalRuntimeApplyRisk: true }],
  ])("keeps the register non-idle for %s", (_label, override) => {
    expect(
      buildRegisterOperationalIdleState({
        hasActiveSaleWork: false,
        hasCheckoutMutationInFlight: false,
        hasDrawerTransitionInFlight: false,
        hasLocalRuntimeApplyRisk: false,
        ...override,
      }),
    ).toEqual({ isIdle: false });
  });

  it("reports idle only after every blocker clears", () => {
    expect(
      buildRegisterOperationalIdleState({
        hasActiveSaleWork: false,
        hasCheckoutMutationInFlight: false,
        hasDrawerTransitionInFlight: false,
        hasLocalRuntimeApplyRisk: false,
      }),
    ).toEqual({ isIdle: true });
  });
});

describe("buildRegisterUpdateApplyBlockerState", () => {
  it("prioritizes checkout mutation work before other register update blockers", () => {
    expect(
      buildRegisterUpdateApplyBlockerState({
        hasActiveSaleWork: true,
        hasCheckoutMutationInFlight: true,
        hasDrawerTransitionInFlight: true,
        hasLocalRuntimeApplyRisk: true,
      }),
    ).toEqual({
      active: true,
      priority: "critical-workflow",
      label: "Sale update in progress",
      guidance: "Finish the current sale update before applying the update.",
    });
  });

  it("blocks refresh while drawer or register transitions are running", () => {
    expect(
      buildRegisterUpdateApplyBlockerState({
        hasActiveSaleWork: false,
        hasCheckoutMutationInFlight: false,
        hasDrawerTransitionInFlight: true,
        hasLocalRuntimeApplyRisk: false,
      }),
    ).toEqual({
      active: true,
      priority: "critical-workflow",
      label: "Register change in progress",
      guidance: "Finish the register change before applying the update.",
    });
  });

  it("blocks refresh while local register state is still saving", () => {
    expect(
      buildRegisterUpdateApplyBlockerState({
        hasActiveSaleWork: false,
        hasCheckoutMutationInFlight: false,
        hasDrawerTransitionInFlight: false,
        hasLocalRuntimeApplyRisk: true,
      }),
    ).toEqual({
      active: true,
      priority: "critical-workflow",
      label: "Register saving",
      guidance:
        "Wait for this register to finish saving before applying the update.",
    });
  });
});

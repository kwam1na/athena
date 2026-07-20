import { describe, expect, it } from "vitest";

import {
  buildRegisterOperationalIdleState,
  buildRegisterUpdateApplyBlockerState,
  hasBlockingAuthorityPersistenceFailure,
} from "./registerUiState";

describe("hasBlockingAuthorityPersistenceFailure", () => {
  it("never blocks when persistence has not failed", () => {
    for (const status of ["idle", "applying", "ready"] as const) {
      expect(hasBlockingAuthorityPersistenceFailure({ status })).toBe(false);
    }
  });

  it("never blocks a transitional authority re-settle", () => {
    // The flash case: opening a replacement drawer re-settles cloud authority against a
    // transitional snapshot. These reasons are not save failures and must not surface the gate.
    for (const reason of ["mapping_invalidated", "candidate_invalid"] as const) {
      expect(
        hasBlockingAuthorityPersistenceFailure({ reason, status: "failed" }),
      ).toBe(false);
    }
  });

  it("blocks genuine persistence failures", () => {
    for (const reason of ["write_failed", "snapshot_invalid"] as const) {
      expect(
        hasBlockingAuthorityPersistenceFailure({ reason, status: "failed" }),
      ).toBe(true);
    }
  });

  it("blocks a failure with no reason", () => {
    expect(hasBlockingAuthorityPersistenceFailure({ status: "failed" })).toBe(
      true,
    );
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

import { describe, expect, it } from "vitest";

import {
  buildRegisterOperationalIdleState,
  buildRegisterUpdateApplyBlockerState,
} from "./registerUiState";

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

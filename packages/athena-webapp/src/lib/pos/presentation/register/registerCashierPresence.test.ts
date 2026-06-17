import { describe, expect, it } from "vitest";

import {
  canOperateRegister,
  hasRegisterManagerRole,
  hasRegisterOperatorRole,
  isCashierPresenceBlockingSale,
  validateRestoredCashierPresence,
  type RestoredCashierPresence,
} from "./registerCashierPresence";

const validPresence: RestoredCashierPresence = {
  activeRoles: ["cashier"],
  displayName: "Ato Kwamina",
  operatingDate: "2026-06-16",
  organizationId: "org-1",
  proofExpiresAt: 2_000,
  staffProfileId: "staff-1",
  storeId: "store-1",
  terminalId: "terminal-1",
};

describe("registerCashierPresence", () => {
  it("accepts a scoped operator presence as validation pending", () => {
    expect(
      validateRestoredCashierPresence({
        isOnline: true,
        now: 1_000,
        operatingDate: "2026-06-16",
        organizationId: "org-1",
        presence: validPresence,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({
      message: "Checking cashier access before new sales.",
      status: "validation_pending",
    });
  });

  it("invalidates mismatched scope before restoring staff proof", () => {
    expect(
      validateRestoredCashierPresence({
        isOnline: true,
        now: 1_000,
        operatingDate: "2026-06-16",
        organizationId: "org-1",
        presence: { ...validPresence, terminalId: "terminal-2" },
        storeId: "store-1",
        terminalId: "terminal-1",
      }).status,
    ).toBe("invalidated");
  });

  it("distinguishes expired proof from expired offline freshness", () => {
    expect(
      validateRestoredCashierPresence({
        isOnline: true,
        now: 2_000,
        operatingDate: "2026-06-16",
        organizationId: "org-1",
        presence: { ...validPresence, proofExpiresAt: 1_999 },
        storeId: "store-1",
        terminalId: "terminal-1",
      }).status,
    ).toBe("expired");

    expect(
      validateRestoredCashierPresence({
        isOnline: false,
        now: 2_000,
        operatingDate: "2026-06-16",
        organizationId: "org-1",
        presence: {
          ...validPresence,
          offlineFreshUntil: 1_999,
          proofExpiresAt: 3_000,
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }).status,
    ).toBe("offline_freshness_expired");
  });

  it("keeps role helpers aligned to register operation", () => {
    expect(hasRegisterOperatorRole(["cashier"])).toBe(true);
    expect(hasRegisterOperatorRole(["manager"])).toBe(true);
    expect(hasRegisterOperatorRole(["stylist"])).toBe(false);
    expect(hasRegisterManagerRole(["cashier", "manager"])).toBe(true);
    expect(isCashierPresenceBlockingSale("validation_pending")).toBe(true);

    expect(
      canOperateRegister({
        credentialStatus: "active",
        roles: ["cashier"],
        status: "active",
      }),
    ).toBe(true);
    expect(
      canOperateRegister({
        credentialStatus: "pending",
        roles: ["cashier"],
        status: "active",
      }),
    ).toBe(false);
  });
});

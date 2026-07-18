import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  bindRegisterBaselineToTerminal,
  getContext,
  getRegisterBootstrap,
  requestManualRestore,
  resetBrowserExperience,
  selectSharedDemoRegisterBootstrapRecords,
} from "./public";

describe("shared demo public contract", () => {
  it("accepts context and restore result envelopes", () => {
    assertConformsToExportedReturns(getContext, null);
    assertConformsToExportedReturns(getRegisterBootstrap, {
      kind: "shared_demo",
      storeId: "store-1",
      staff: {
        activeRoles: ["cashier"],
        displayName: "Efua Tetteh",
        staffProfileId: "staff-1",
      },
      terminal: {
        _id: "terminal-1",
        displayName: "Studio Front Register",
        loginMode: "pos_only",
        registerNumber: "DEMO-01",
        status: "active",
        transactionCapability: "products_and_services",
      },
    });
    assertConformsToExportedReturns(requestManualRestore, {
      baselineVersion: 1,
      epoch: 2,
      kind: "started",
    });
    assertConformsToExportedReturns(resetBrowserExperience, {
      baselineVersion: 1,
      epoch: 3,
      terminalDeleted: true,
    });
    assertConformsToExportedReturns(bindRegisterBaselineToTerminal, {
      bootstrap: {
        cloudRegisterSessionId: "register-session-1",
        expectedCash: 35_000,
        localRegisterSessionId: "register-session-1",
        openedAt: 1,
        openingFloat: 30_000,
        registerNumber: "213305",
        staffProfileId: "staff-manager",
        status: "active",
      },
      managerDisplayName: "Kwabena Osei",
      openedAt: 1,
      operatingDate: "2026-07-14",
      registerNumber: "213305",
      terminalId: "terminal-1",
      timezone: "America/New_York",
    });
  });

  it("exposes the frontend context and manual restore contract without a store argument", () => {
    const source = readFileSync("convex/sharedDemo/public.ts", "utf8");
    expect(source).toContain("export const getContext = query");
    expect(source).toContain("export const requestManualRestore = mutation");
    expect(source).toContain("export const resetBrowserExperience = mutation");
    expect(source).toContain("args: { idempotencyKey: v.string() }");
    expect(source).toContain("beginRestoreLeaseWithCtx(ctx");
    expect(source).toContain("cleanupTerminalId: terminalCleanupRequested ? args.terminalId : undefined");
    expect(source).toContain("terminalDeleted: false");
    expect(source).not.toContain("restoreBaselineImmediatelyWithCtx");
    expect(source).not.toContain("args: { storeId:");
  });

  it("selects the seeded cashier without requiring an open register session", () => {
    expect(
      selectSharedDemoRegisterBootstrapRecords({
        staffProfiles: [
          {
            _id: "staff-1",
            fullName: "Efua Tetteh",
            staffCode: "DEMO-001",
            status: "active",
            storeId: "store-1",
          },
        ],
        storeId: "store-1",
        terminals: [
          {
            _id: "terminal-1",
            displayName: "Studio Front Register",
            registerNumber: "DEMO-01",
            status: "active",
            storeId: "store-1",
          },
        ],
      }),
    ).toMatchObject({
      staffProfile: { _id: "staff-1" },
      terminal: { _id: "terminal-1" },
    });
  });
});

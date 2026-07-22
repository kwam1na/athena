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
import { SHARED_DEMO_REGISTER_NUMBER } from "./config";

describe("shared demo public contract", () => {
  it("accepts context and restore result envelopes", () => {
    assertConformsToExportedReturns(getContext, null);
    assertConformsToExportedReturns(getRegisterBootstrap, {
      kind: "shared_demo",
      storeId: "store-1",
      staff: {
        activeRoles: ["cashier"],
        displayName: "Afua Okyere",
        staffProfileId: "staff-1",
      },
      terminal: {
        _id: "terminal-1",
        displayName: "Studio Front Register",
        loginMode: "pos_only",
        registerNumber: SHARED_DEMO_REGISTER_NUMBER,
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
      managerDisplayName: "Kwabena Agyei",
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
    expect(source).toContain("handler: admitPublicMutation(");
    expect(source).toContain("requestManualRestoreOperationDefinition");
    expect(source).toContain("resetBrowserExperienceOperationDefinition");
    expect(source).toContain(
      "bindRegisterBaselineToTerminalOperationDefinition",
    );
    expect(source).toContain(
      'args: { expectedEpoch: v.number(), terminalId: v.id("posTerminal") }',
    );
    expect(source).toContain("assertSharedDemoWriteEpoch(");
    expect(source).toContain("beginRestoreLeaseWithCtx(ctx");
    expect(source).toMatch(
      /cleanupTerminalId:\s*terminalCleanupRequested\s*\?\s*args\.terminalId\s*:\s*undefined/,
    );
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
            fullName: "Afua Okyere",
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
            registerNumber: SHARED_DEMO_REGISTER_NUMBER,
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  getContext,
  getRegisterBootstrap,
  requestManualRestore,
} from "./public";

describe("shared demo public contract", () => {
  it("accepts context and restore result envelopes", () => {
    assertConformsToExportedReturns(getContext, null);
    assertConformsToExportedReturns(getRegisterBootstrap, {
      kind: "shared_demo",
      storeId: "store-1",
      staff: {
        activeRoles: ["cashier"],
        displayName: "Ama Mensah",
        staffProfileId: "staff-1",
      },
      terminal: {
        _id: "terminal-1",
        displayName: "Demo Front Register",
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
  });

  it("exposes the frontend context and manual restore contract without a store argument", () => {
    const source = readFileSync("convex/sharedDemo/public.ts", "utf8");
    expect(source).toContain("export const getContext = query");
    expect(source).toContain("export const requestManualRestore = mutation");
    expect(source).toContain("args: { idempotencyKey: v.string() }");
    expect(source).not.toContain("args: { storeId:");
  });
});

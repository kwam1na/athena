import { describe, expect, it } from "vitest";
import {
  DAILY_CLOSE_CARRY_FORWARD_RESOLUTION_ACTION,
  DAILY_CLOSE_COMPLETION_ACTION,
  buildDailyCloseCarryForwardApprovalRequirement,
  buildDailyCloseCompletionApprovalRequirement,
} from "./approval";

describe("daily close approval requirements", () => {
  it("builds completion approval subjects without changing the action contract", () => {
    const requirement = buildDailyCloseCompletionApprovalRequirement({
      operatingDate: "2026-05-07",
      storeId: "store-1" as never,
    });

    expect(requirement).toMatchObject({
      action: DAILY_CLOSE_COMPLETION_ACTION,
      requiredRole: "manager",
      selfApproval: "allowed",
      subject: {
        id: "store-1:2026-05-07",
        label: "EOD Review 2026-05-07",
        type: "daily_close",
      },
    });
  });

  it("binds carry-forward approval subjects to source and outcome", () => {
    const requirement = buildDailyCloseCarryForwardApprovalRequirement({
      businessDate: "2026-05-07",
      dailyCloseId: "daily-close-1" as never,
      outcome: "cancelled",
      sourceId: "source-1",
    });

    expect(requirement).toMatchObject({
      action: DAILY_CLOSE_CARRY_FORWARD_RESOLUTION_ACTION,
      subject: {
        id: "daily-close-1:source-1:cancelled",
        type: "daily_close_carry_forward",
      },
      metadata: {
        businessDate: "2026-05-07",
        dailyCloseId: "daily-close-1",
        outcome: "cancelled",
        sourceId: "source-1",
      },
    });
  });
});

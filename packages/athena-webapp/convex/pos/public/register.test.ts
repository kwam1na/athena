import { describe, it } from "vitest";

import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";
import { openDrawer } from "./register";

describe("pos public register contracts", () => {
  it("accepts review-only closeout register-session statuses in command results", () => {
    assertConformsToExportedReturns(openDrawer as never, {
      kind: "ok",
      data: {
        _id: "register-session-1",
        status: "closeout_rejected",
        terminalId: "terminal-1",
        registerNumber: "8",
        openingFloat: 100,
        expectedCash: 100,
        openedAt: 1_000,
        notes: "Manager rejected variance closeout.",
        workflowTraceId: "trace-register-session-1",
      },
    });
  });
});

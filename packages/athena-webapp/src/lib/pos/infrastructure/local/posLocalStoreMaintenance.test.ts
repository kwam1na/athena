import { describe, expect, it } from "vitest";

import {
  assessPosLocalStoreClear,
  runExclusivePosLocalStoreMaintenance,
  type PosLocalStoreClearInspection,
} from "./posLocalStoreMaintenance";

describe("POS local store maintenance", () => {
  it("fails closed when inspection finds protected evidence", () => {
    expect(
      assessPosLocalStoreClear({
        status: "complete",
        activePresenceCount: 0,
        activeWorkflowCount: 0,
        authorityRecordCount: 1,
        eventCount: 0,
        migrationInProgress: false,
        retainedSource: false,
        unresolvedActivityCount: 0,
      }),
    ).toEqual({ allowed: false, reason: "authority_present" });
    expect(assessPosLocalStoreClear({ status: "failed" })).toEqual({
      allowed: false,
      reason: "inspection_failed",
    });
  });

  it.each([Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY])(
    "fails closed for malformed inspection count %s",
    (eventCount) => {
      expect(
        assessPosLocalStoreClear({
          status: "complete",
          activePresenceCount: 0,
          activeWorkflowCount: 0,
          authorityRecordCount: 0,
          eventCount,
          migrationInProgress: false,
          retainedSource: false,
          unresolvedActivityCount: 0,
        }),
      ).toEqual({ allowed: false, reason: "inspection_failed" });
    },
  );

  it("fails closed when a complete result omits a required field at runtime", () => {
    expect(
      assessPosLocalStoreClear({
        status: "complete",
        activePresenceCount: 0,
        activeWorkflowCount: 0,
        authorityRecordCount: 0,
        eventCount: 0,
        migrationInProgress: false,
        unresolvedActivityCount: 0,
      } as PosLocalStoreClearInspection),
    ).toEqual({
      allowed: false,
      reason: "inspection_failed",
    });
  });

  it("uses an opaque exclusive session and always closes it", async () => {
    const calls: string[] = [];
    const result = await runExclusivePosLocalStoreMaintenance(
      {
        beginExclusiveMaintenance: async () => ({
          close: async () => {
            calls.push("close");
          },
          run: async (operation) => {
            calls.push("run");
            return operation();
          },
        }),
      },
      async () => "done",
    );

    expect(result).toEqual({ status: "completed", value: "done" });
    expect(calls).toEqual(["run", "close"]);
  });
});

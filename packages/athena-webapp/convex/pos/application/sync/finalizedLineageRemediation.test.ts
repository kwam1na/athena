import { describe, expect, it } from "vitest";

import { classifyFinalizedLineageRepairConflicts } from "./finalizedLineageRemediation";
import type { LocalSyncConflictRecord } from "./types";

describe("finalized lineage remediation", () => {
  it("accepts only open finalized-lineage inventory conflicts in the target register session", () => {
    expect(
      classifyFinalizedLineageRepairConflicts(
        [
          repairConflict("conflict-1"),
          {
            ...repairConflict("conflict-2"),
            status: "resolved",
          },
        ],
        "local-register-session-1",
      ),
    ).toEqual({
      kind: "repairable",
      repairedConflictCount: 1,
    });
  });

  it("refuses to repair events that still have unrelated open conflicts", () => {
    expect(
      classifyFinalizedLineageRepairConflicts(
        [
          repairConflict("conflict-1"),
          {
            ...repairConflict("conflict-2"),
            summary: "Product price changed before this offline sale synced.",
          },
        ],
        "local-register-session-1",
      ),
    ).toEqual({
      kind: "skipped",
      reason: "event_has_unrelated_open_conflicts",
    });
  });

  it("refuses conflicts outside the target register session", () => {
    expect(
      classifyFinalizedLineageRepairConflicts(
        [
          {
            ...repairConflict("conflict-1"),
            localRegisterSessionId: "other-register-session",
          },
        ],
        "local-register-session-1",
      ),
    ).toEqual({
      kind: "skipped",
      reason: "conflict_wrong_register_session",
    });
  });
});

function repairConflict(id: string): LocalSyncConflictRecord {
  return {
    _id: id,
    storeId: "store-1" as never,
    terminalId: "terminal-1" as never,
    localRegisterSessionId: "local-register-session-1",
    localEventId: "local-sale-event-1",
    sequence: 10,
    conflictType: "inventory",
    status: "needs_review",
    summary: "Provisional import row changed before this offline sale synced.",
    details: {},
    createdAt: 1_700_000_000_000,
  };
}

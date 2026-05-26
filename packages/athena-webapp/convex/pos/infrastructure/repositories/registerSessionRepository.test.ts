import { describe, expect, it } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import { buildRegisterSessionLocalSyncStatus } from "../../application/sync/registerSessionSyncReview";

describe("register session repository", () => {
  it("maps closeout sync conflicts into register-session review status", () => {
    const result = buildRegisterSessionLocalSyncStatus([
      {
        _id: "sync-conflict-1" as Id<"posLocalSyncConflict">,
        conflictType: "permission",
        createdAt: 1710000000000,
        details: {
          countedCash: 4_500,
          expectedCash: 5_000,
          variance: -500,
        },
        localEventId: "event-register-closed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 3,
        status: "needs_review",
        storeId: "store-1" as Id<"store">,
        summary:
          "Register closeout variance requires manager review before synced closeout can be applied.",
        terminalId: "terminal-1" as Id<"posTerminal">,
      },
    ]);

    expect(result).toEqual({
      status: "needs_review",
      reconciliationItems: [
        {
          createdAt: 1710000000000,
          countedCash: 4_500,
          expectedCash: 5_000,
          id: "sync-conflict-1",
          localEventId: "event-register-closed-1",
          sequence: 3,
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          type: "register_closeout",
          variance: -500,
        },
      ],
    });
  });
});

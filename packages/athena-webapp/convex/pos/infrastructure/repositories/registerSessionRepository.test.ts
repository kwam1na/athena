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
          notes: "Short drawer",
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
      {
        _id: "sync-conflict-2" as Id<"posLocalSyncConflict">,
        conflictType: "permission",
        createdAt: 1710000000001,
        details: {
          countedCash: 4_700,
          expectedCash: 5_000,
          variance: -300,
        },
        localEventId: "event-register-closed-2",
        localRegisterSessionId: "local-register-1",
        sequence: 4,
        sourceEventNotes: "Recovered from source event",
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
          actionPolicy: "apply_or_reject",
          createdAt: 1710000000000,
          countedCash: 4_500,
          expectedCash: 5_000,
          id: "sync-conflict-1",
          localEventId: "event-register-closed-1",
          notes: "Short drawer",
          reviewKind: "register_closeout_variance",
          sequence: 3,
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          type: "register_closeout",
          variance: -500,
        },
        {
          actionPolicy: "apply_or_reject",
          createdAt: 1710000000001,
          countedCash: 4_700,
          expectedCash: 5_000,
          id: "sync-conflict-2",
          localEventId: "event-register-closed-2",
          notes: "Recovered from source event",
          reviewKind: "register_closeout_variance",
          sequence: 4,
          status: "needs_review",
          summary:
            "Register closeout variance requires manager review before synced closeout can be applied.",
          type: "register_closeout",
          variance: -300,
        },
      ],
    });
  });
});

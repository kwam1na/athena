import { describe, expect, it } from "vitest";

import {
  PERSISTENT_SYNC_FAILURE_SUMMARY,
  classifyRegisterSessionSyncReview,
} from "./registerSessionSyncReview";

describe("classifyRegisterSessionSyncReview — persistent sync failure dead-letter", () => {
  it("classifies the dead-letter conflict as a reject-only server_rejected review", () => {
    const classification = classifyRegisterSessionSyncReview({
      conflictType: "server_rejected",
      details: { code: "persistent_sync_failure" },
      localEventId: "event-1",
      status: "needs_review",
      summary: PERSISTENT_SYNC_FAILURE_SUMMARY,
    });

    // reject_only: there is nothing to apply — the server never accepted the
    // batch, so the only manager action is to acknowledge/reject the marker.
    expect(classification).toEqual({
      actionPolicy: "reject_only",
      conflictType: "server_rejected",
      reviewKind: "server_rejected",
    });
  });

  it("keeps ordinary server_rejected conflicts on the override_or_reject policy", () => {
    const classification = classifyRegisterSessionSyncReview({
      conflictType: "server_rejected",
      details: {},
      localEventId: "event-1",
      status: "needs_review",
      summary: "POS sale was rejected during sync and needs review.",
    });

    expect(classification.actionPolicy).toBe("override_or_reject");
  });
});

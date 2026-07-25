import { describe, expect, it } from "vitest";

import { diagnoseHeldSyncBlocker } from "./syncGapDiagnosis";

describe("held sync blocker diagnosis", () => {
  it("reports no blocker when nothing was held", () => {
    expect(
      diagnoseHeldSyncBlocker({
        acceptedThroughSequence: 16,
        heldEventCount: 0,
        localUploadSequences: [18, 19],
        reviewEventCount: 0,
      }),
    ).toEqual({ kind: "none" });
  });

  it("names the missing sequence when the ledger no longer has it", () => {
    // The M Supplies shape: cursor stuck at 16, 18 and 19 held, and 17 gone
    // from the local ledger entirely.
    expect(
      diagnoseHeldSyncBlocker({
        acceptedThroughSequence: 16,
        heldEventCount: 2,
        localUploadSequences: [18, 19],
        reviewEventCount: 0,
      }),
    ).toEqual({ kind: "missing_locally", missingUploadSequence: 17 });
  });

  it("treats a still-present predecessor as ordinary delivery lag", () => {
    expect(
      diagnoseHeldSyncBlocker({
        acceptedThroughSequence: 16,
        heldEventCount: 2,
        localUploadSequences: [17, 18, 19],
        reviewEventCount: 0,
      }),
    ).toEqual({ kind: "awaiting_local_upload", missingUploadSequence: 17 });
  });

  it("prefers the review blocker when the predecessor is withheld", () => {
    // This is the case the old escalation assumed was always true; it is now
    // one branch of four rather than the default.
    expect(
      diagnoseHeldSyncBlocker({
        acceptedThroughSequence: 16,
        heldEventCount: 2,
        localUploadSequences: [17, 18],
        reviewEventCount: 1,
      }),
    ).toEqual({ kind: "awaiting_review" });
  });

  it("does not blame review when the predecessor is gone", () => {
    // Unrelated review events must not mask a burned sequence, or the terminal
    // reports the wrong blocker and reconciliation never gets its evidence.
    expect(
      diagnoseHeldSyncBlocker({
        acceptedThroughSequence: 16,
        heldEventCount: 2,
        localUploadSequences: [18, 19],
        reviewEventCount: 3,
      }),
    ).toEqual({ kind: "missing_locally", missingUploadSequence: 17 });
  });

  it("handles a cursor that has accepted nothing yet", () => {
    expect(
      diagnoseHeldSyncBlocker({
        acceptedThroughSequence: 0,
        heldEventCount: 1,
        localUploadSequences: [2],
        reviewEventCount: 0,
      }),
    ).toEqual({ kind: "missing_locally", missingUploadSequence: 1 });
  });
});

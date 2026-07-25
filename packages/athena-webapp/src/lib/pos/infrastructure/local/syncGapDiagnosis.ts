/**
 * Terminal-side diagnosis of *why* uploads are held.
 *
 * When the cloud parks a batch as held, the terminal previously learned only
 * that it was blocked — not by what. The runtime then guessed the blocker was a
 * stuck `needs_review` precursor and drove a review-inclusive drain, which is a
 * no-op whenever the real cause is an upload sequence that no longer exists in
 * the local ledger. That guess is why a burned sequence wedged a terminal
 * indefinitely instead of escalating.
 *
 * The cloud tells us exactly which sequence it is waiting on: the next one
 * after `acceptedThroughSequence`. Checking that against the local ledger turns
 * the guess into an answer, and reporting the answer on the heartbeat lets gap
 * reconciliation skip the hole without a probe round trip.
 */

export type HeldSyncBlocker =
  | { kind: "none" }
  /** The awaited predecessor is still local — ordinary delivery lag. */
  | { kind: "awaiting_local_upload"; missingUploadSequence: number }
  /** The awaited predecessor is not in the local ledger and never will be. */
  | { kind: "missing_locally"; missingUploadSequence: number }
  /** Held behind events the terminal is holding back pending manager review. */
  | { kind: "awaiting_review" };

export function diagnoseHeldSyncBlocker(input: {
  /** Cursor position the cloud returned for this batch's sync cursor. */
  acceptedThroughSequence: number;
  /** How many events the cloud parked as held this drain. */
  heldEventCount: number;
  /** Upload sequences present in the local ledger for this same cursor. */
  localUploadSequences: number[];
  /** Local events withheld pending review, for this same cursor. */
  reviewEventCount: number;
}): HeldSyncBlocker {
  if (input.heldEventCount === 0) {
    return { kind: "none" };
  }

  const missingUploadSequence = input.acceptedThroughSequence + 1;

  if (input.localUploadSequences.includes(missingUploadSequence)) {
    // The terminal still holds the awaited event. If it is withheld pending
    // review, that is the actionable blocker; otherwise it is simply a batch
    // that has not been delivered yet and retries will close it.
    return input.reviewEventCount > 0
      ? { kind: "awaiting_review" }
      : { kind: "awaiting_local_upload", missingUploadSequence };
  }

  return { kind: "missing_locally", missingUploadSequence };
}

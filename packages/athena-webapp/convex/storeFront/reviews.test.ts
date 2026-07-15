// Ownership hardening on the review update/delete path changed this public
// Convex module, so its exported return validators need executable contract
// proof: representative handler return values must conform to the `returns`
// validators the module exports.
import { describe, it } from "vitest";
import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  approve,
  hasReviewForOrderItem,
  hasUserReviewForOrderItem,
  publish,
  reject,
  sendFeedbackRequest,
  unpublish,
} from "./reviews";

describe("storefront review public return contracts", () => {
  it("boolean existence queries return booleans", () => {
    assertConformsToExportedReturns(hasReviewForOrderItem, true);
    assertConformsToExportedReturns(hasReviewForOrderItem, false);
    assertConformsToExportedReturns(hasUserReviewForOrderItem, true);
    assertConformsToExportedReturns(hasUserReviewForOrderItem, false);
  });

  it("moderation mutations return command-result envelopes", () => {
    assertConformsToExportedReturns(approve, ok(null));
    assertConformsToExportedReturns(reject, ok(null));
    assertConformsToExportedReturns(publish, ok(null));
    assertConformsToExportedReturns(unpublish, ok(null));
  });

  it("feedback-request action returns a command-result envelope", () => {
    assertConformsToExportedReturns(sendFeedbackRequest, ok(null));
  });

  it("moderation mutations accept a representative user-error envelope", () => {
    assertConformsToExportedReturns(approve, {
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Review not found.",
      },
    });
  });
});

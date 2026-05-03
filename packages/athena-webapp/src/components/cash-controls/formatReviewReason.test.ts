import { describe, expect, it } from "vitest";

import { currencyFormatter } from "~/shared/currencyFormatter";
import { formatReviewReason } from "./formatReviewReason";

describe("formatReviewReason", () => {
  it("formats closeout variance amounts in threshold reasons", () => {
    expect(
      formatReviewReason(
        currencyFormatter("GHS"),
        "Variance of -6100 exceeded the closeout approval threshold.",
      ),
    ).toBe("Variance of GH₵-61 exceeded the closeout approval threshold");
  });

  it("formats closeout variance amounts in manager signoff reasons", () => {
    expect(
      formatReviewReason(
        currencyFormatter("GHS"),
        "Manager signoff is required for any register variance (-6100).",
      ),
    ).toBe("Manager signoff is required for any register variance (GH₵-61)");
  });
});

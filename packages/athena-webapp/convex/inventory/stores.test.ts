import { describe, it } from "vitest";

import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { calculateTax, patchConfigV2Command } from "./stores";

describe("store public return contracts", () => {
  it("preserves configuration and tax results behind demo restrictions", () => {
    assertConformsToExportedReturns(patchConfigV2Command, ok(null));
    assertConformsToExportedReturns(calculateTax, {
      taxAmount: 0,
      totalWithTax: 2_500,
      taxRate: 0,
      taxName: "Tax",
    });
  });
});

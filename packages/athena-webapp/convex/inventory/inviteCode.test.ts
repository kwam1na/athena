import { describe, it } from "vitest";

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { create, getAll, redeem } from "./inviteCode";

describe("inventory invite-code return contracts", () => {
  it("accepts representative public invite-code results", () => {
    const rejectedInvite = {
      success: false,
      message: "Invalid invite code",
    };

    assertConformsToExportedReturns(redeem, rejectedInvite);
    assertConformsToExportedReturns(create, rejectedInvite);
    assertConformsToExportedReturns(getAll, []);
  });
});

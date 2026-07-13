import { describe, it } from "vitest";

// Shared-demo denial preserves the existing authentication result envelope.

import { userError } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { syncAuthenticatedAthenaUser, verifyCode } from "./auth";

describe("inventory auth return contracts", () => {
  it("accepts the public authentication error envelope", () => {
    const authenticationFailure = userError({
      code: "authentication_failed",
      message: "Sign in again to continue.",
    });

    assertConformsToExportedReturns(verifyCode, authenticationFailure);
    assertConformsToExportedReturns(
      syncAuthenticatedAthenaUser,
      authenticationFailure,
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  assertDeliveryDocumentationCheck,
  parseArgs,
} from "./delivery-documentation-check";

describe("delivery documentation check", () => {
  it("reports solution-note and landed-report findings together", () => {
    expect(() =>
      assertDeliveryDocumentationCheck("/repo", {
        assertCompoundSolutionCheck: () => {
          throw new Error("Compound solution check failed:\n- Missing solution note.");
        },
        assertLandedChangeReportCheck: () => {
          throw new Error("Landed-change report check failed:\n- Missing report.");
        },
      }),
    ).toThrow(
      "Delivery documentation check failed:\n\nSolution notes:\n- Missing solution note.\n\nLanded-change reports:\n- Missing report.",
    );
  });

  it("passes when both documentation policies pass", () => {
    expect(() =>
      assertDeliveryDocumentationCheck("/repo", {
        assertCompoundSolutionCheck: () => {},
        assertLandedChangeReportCheck: () => {},
      }),
    ).not.toThrow();
  });

  it("preserves unexpected operational failures", () => {
    expect(() =>
      assertDeliveryDocumentationCheck("/repo", {
        assertCompoundSolutionCheck: () => {
          throw new Error("git merge-base failed");
        },
      }),
    ).toThrow("git merge-base failed");
  });

  it("parses the shared sensor CLI options", () => {
    expect(parseArgs(["--base", "origin/release", "--threshold", "42", "--print-fingerprint"])).toEqual({
      baseRef: "origin/release",
      threshold: 42,
      printFingerprint: true,
    });
  });
});

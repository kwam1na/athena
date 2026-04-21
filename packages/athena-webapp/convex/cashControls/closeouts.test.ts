import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildRegisterSessionCloseoutReview,
  getCashControlsConfig,
} from "./closeouts";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("cash control closeouts", () => {
  it("uses a sensible default approval threshold when store config is absent", () => {
    expect(getCashControlsConfig()).toEqual({
      requireManagerSignoffForAnyVariance: false,
      requireManagerSignoffForOvers: false,
      requireManagerSignoffForShorts: false,
      varianceApprovalThreshold: 5000,
    });
  });

  it("does not require approval for exact-match or small-variance closeouts", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: getCashControlsConfig(),
        countedCash: 10000,
        expectedCash: 10000,
      })
    ).toMatchObject({
      hasVariance: false,
      requiresApproval: false,
      variance: 0,
    });

    expect(
      buildRegisterSessionCloseoutReview({
        config: getCashControlsConfig(),
        countedCash: 9700,
        expectedCash: 10000,
      })
    ).toMatchObject({
      hasVariance: true,
      requiresApproval: false,
      variance: -300,
    });
  });

  it("requires approval when a variance exceeds the configured threshold", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: getCashControlsConfig(),
        countedCash: 16050,
        expectedCash: 10000,
      })
    ).toMatchObject({
      hasVariance: true,
      reason: "Variance of 6050 exceeded the closeout approval threshold.",
      requiresApproval: true,
      variance: 6050,
    });
  });

  it("supports configured manager signoff for specific variance directions", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: {
          ...getCashControlsConfig(),
          requireManagerSignoffForShorts: true,
        },
        countedCash: 9800,
        expectedCash: 10000,
      })
    ).toMatchObject({
      requiresApproval: true,
      variance: -200,
    });

    expect(
      buildRegisterSessionCloseoutReview({
        config: {
          ...getCashControlsConfig(),
          requireManagerSignoffForOvers: true,
        },
        countedCash: 10200,
        expectedCash: 10000,
      })
    ).toMatchObject({
      requiresApproval: true,
      variance: 200,
    });
  });

  it("writes through approval, register-session, and operational-event rails", () => {
    const source = getSource("./closeouts.ts");

    expect(source).toContain("buildApprovalRequest");
    expect(source).toContain("recordOperationalEventWithCtx");
    expect(source).toContain("beginRegisterSessionCloseout");
    expect(source).toContain("closeRegisterSession");
    expect(source).toContain("decideApprovalRequest");
  });
});

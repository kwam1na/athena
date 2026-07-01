import { describe, expect, it } from "vitest";
import {
  buildRegisterSessionCloseoutReview,
  getCashControlsConfig,
} from "./registerSessionCloseoutGate";

describe("register session closeout gate", () => {
  it("uses default cash controls config when store config is absent", () => {
    expect(getCashControlsConfig()).toEqual({
      requireManagerSignoffForAnyVariance: false,
      requireManagerSignoffForOvers: false,
      requireManagerSignoffForShorts: false,
      varianceApprovalThreshold: 5000,
    });
  });

  it("allows exact counts and under-threshold variances by default", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: getCashControlsConfig(),
        countedCash: 10000,
        expectedCash: 10000,
      }),
    ).toEqual({
      hasVariance: false,
      reason: undefined,
      requiresApproval: false,
      variance: 0,
    });

    expect(
      buildRegisterSessionCloseoutReview({
        config: getCashControlsConfig(),
        countedCash: 9800,
        expectedCash: 10000,
      }),
    ).toEqual({
      hasVariance: true,
      reason: undefined,
      requiresApproval: false,
      variance: -200,
    });
  });

  it("requires approval when variance exceeds the configured threshold", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: getCashControlsConfig({
          config: {
            operations: {
              cashControls: {
                varianceApprovalThreshold: 250,
              },
            },
          },
        }),
        countedCash: 10300,
        expectedCash: 10000,
      }),
    ).toEqual({
      hasVariance: true,
      reason: "Variance of 300 exceeded the closeout approval threshold.",
      requiresApproval: true,
      variance: 300,
    });
  });

  it("requires approval for any variance when configured", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: {
          ...getCashControlsConfig(),
          requireManagerSignoffForAnyVariance: true,
        },
        countedCash: 9999,
        expectedCash: 10000,
      }),
    ).toEqual({
      hasVariance: true,
      reason: "Manager signoff is required for any register variance (-1).",
      requiresApproval: true,
      variance: -1,
    });
  });

  it("requires approval only for configured overage direction", () => {
    const config = {
      ...getCashControlsConfig(),
      requireManagerSignoffForOvers: true,
    };

    expect(
      buildRegisterSessionCloseoutReview({
        config,
        countedCash: 10001,
        expectedCash: 10000,
      }),
    ).toEqual({
      hasVariance: true,
      reason: "Manager signoff is required for register overages (1).",
      requiresApproval: true,
      variance: 1,
    });

    expect(
      buildRegisterSessionCloseoutReview({
        config,
        countedCash: 9999,
        expectedCash: 10000,
      }),
    ).toEqual({
      hasVariance: true,
      reason: undefined,
      requiresApproval: false,
      variance: -1,
    });
  });

  it("requires approval only for configured shortage direction", () => {
    const config = {
      ...getCashControlsConfig(),
      requireManagerSignoffForShorts: true,
    };

    expect(
      buildRegisterSessionCloseoutReview({
        config,
        countedCash: 9999,
        expectedCash: 10000,
      }),
    ).toEqual({
      hasVariance: true,
      reason: "Manager signoff is required for register shortages (-1).",
      requiresApproval: true,
      variance: -1,
    });

    expect(
      buildRegisterSessionCloseoutReview({
        config,
        countedCash: 10001,
        expectedCash: 10000,
      }),
    ).toEqual({
      hasVariance: true,
      reason: undefined,
      requiresApproval: false,
      variance: 1,
    });
  });

  it("treats rounded zero variance as no-approval", () => {
    expect(
      buildRegisterSessionCloseoutReview({
        config: {
          ...getCashControlsConfig(),
          requireManagerSignoffForAnyVariance: true,
        },
        countedCash: 10000.4,
        expectedCash: 10000.49,
      }),
    ).toEqual({
      hasVariance: false,
      reason: undefined,
      requiresApproval: false,
      variance: 0,
    });
  });
});

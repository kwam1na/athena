import { describe, expect, it } from "vitest";

import { compareCoverageBindings, type CoverageCapture } from "./harness-review-coverage";

const successfulCapture: CoverageCapture = {
  binding: { identity: "prepared-tree/base/toolchain/dependencies", environment: "private execution inputs" },
};

describe("coverage binding admission", () => {
  it("never treats two identical unavailable captures as successful evidence", () => {
    const unavailable: CoverageCapture = { reason: "coverage-inputs-unavailable" };
    expect(compareCoverageBindings(unavailable, unavailable)).toBe("coverage-inputs-unavailable");
  });

  it("requires successful capture at both boundaries", () => {
    const unprepared: CoverageCapture = { reason: "source-not-prepared" };
    expect(compareCoverageBindings(unprepared, successfulCapture)).toBe("source-not-prepared");
    expect(compareCoverageBindings(successfulCapture, unprepared)).toBe("source-not-prepared");
  });

  it("rejects a different candidate even with the same private execution inputs", () => {
    const changed: CoverageCapture = { binding: { ...successfulCapture.binding, identity: "changed candidate" } };
    expect(compareCoverageBindings(successfulCapture, changed)).toBe("source-base-toolchain-or-dependencies-changed");
  });

  it("rejects changed private inputs without returning their values", () => {
    const changed: CoverageCapture = { binding: { ...successfulCapture.binding, environment: "SENTINEL_SECRET=not-for-output" } };
    const reason = compareCoverageBindings(successfulCapture, changed);
    expect(reason).toBe("execution-environment-changed");
    expect(reason).not.toContain("not-for-output");
  });

  it("admits independently captured equal inputs rather than requiring object identity", () => {
    const recaptured: CoverageCapture = { binding: { ...successfulCapture.binding } };
    expect(compareCoverageBindings(successfulCapture, recaptured)).toBeUndefined();
  });
});

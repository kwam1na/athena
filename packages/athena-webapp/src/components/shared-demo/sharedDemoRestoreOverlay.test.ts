import { describe, expect, it } from "vitest";

import { resolveSharedDemoRestoreOverlayPhase } from "./sharedDemoRestoreOverlayModel";

describe("resolveSharedDemoRestoreOverlayPhase", () => {
  it("covers the app while the server restores the baseline", () => {
    expect(
      resolveSharedDemoRestoreOverlayPhase({
        bootstrapStatus: "provisioning",
        hasAppliedRestoreEpoch: false,
        restoreStatus: "restoring",
      }),
    ).toBe("restoring");
  });

  it("stays visible until this browser applies the published restore epoch", () => {
    expect(
      resolveSharedDemoRestoreOverlayPhase({
        bootstrapStatus: "provisioning",
        hasAppliedRestoreEpoch: false,
        restoreStatus: "ready",
      }),
    ).toBe("preparing");
  });

  it("covers a missed server transition when the browser observes a newer epoch", () => {
    expect(
      resolveSharedDemoRestoreOverlayPhase({
        bootstrapStatus: "ready",
        hasAppliedRestoreEpoch: false,
        restoreStatus: "ready",
      }),
    ).toBe("preparing");
  });

  it("clears only after the browser applies the current epoch", () => {
    expect(
      resolveSharedDemoRestoreOverlayPhase({
        bootstrapStatus: "ready",
        hasAppliedRestoreEpoch: true,
        restoreStatus: "ready",
      }),
    ).toBe("hidden");
  });

  it("offers recovery for server and browser reconciliation failures", () => {
    expect(
      resolveSharedDemoRestoreOverlayPhase({
        bootstrapStatus: "ready",
        hasAppliedRestoreEpoch: false,
        restoreStatus: "failed",
      }),
    ).toBe("failed");
    expect(
      resolveSharedDemoRestoreOverlayPhase({
        bootstrapStatus: "failed",
        hasAppliedRestoreEpoch: false,
        restoreStatus: "ready",
      }),
    ).toBe("failed");
  });
});

import { describe, expect, it } from "vitest";

import {
  getTerminalRuntimeMaterialSignature,
  projectTerminalRuntimeMaterial,
} from "./terminalRuntimeMaterial";

describe("terminal runtime material", () => {
  const base = {
    activeRegisterSession: {
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "local-register-1",
      observedAt: 100,
      status: "active",
    },
    appSessionRecovery: { status: "recovering" },
    appUpdate: {
      canApply: false,
      commandExecutionId: "execution-1",
      detectorStatus: "ok",
      observedAt: 100,
      stagingAssetCount: 4,
      status: "applying",
    },
    browserInfo: { online: true, userAgent: "Athena/old" },
    drawerAuthority: {
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "local-register-1",
      observedAt: 100,
      status: "healthy",
    },
    localStore: {
      available: true,
      healthObservedAt: 100,
      schemaVersion: 1,
      terminalSeedReady: true,
      usageBytes: 100,
    },
    reportedAt: 100,
    saleAuthority: { observedAt: 100, status: "ready" },
    snapshots: { catalogAgeMs: 100 },
    staffAuthority: {
      expiresAt: 500,
      staffProfileId: "staff-1",
      status: "ready",
    },
    sync: {
      failedEventCount: 3,
      lastTrigger: "interval",
      pendingEventCount: 5,
      reviewEventCount: 0,
      reviewEvents: [],
      status: "idle",
    },
    terminalIntegrity: { observedAt: 100, status: "healthy" },
  };

  it("drops volatile diagnostics consistently", () => {
    const changedVolatile = {
      ...base,
      appUpdate: {
        ...base.appUpdate,
        canApply: true,
        observedAt: 200,
        stagingAssetCount: 9,
      },
      browserInfo: { online: false, userAgent: "Athena/new" },
      localStore: {
        ...base.localStore,
        healthObservedAt: 200,
        schemaVersion: 2,
        usageBytes: 900,
      },
      reportedAt: 200,
      snapshots: { catalogAgeMs: 200 },
      staffAuthority: {
        expiresAt: 900,
        staffProfileId: "staff-1",
        status: "ready",
      },
      sync: {
        ...base.sync,
        failedEventCount: 9,
        lastTrigger: "manual",
        pendingEventCount: 12,
      },
    };

    expect(getTerminalRuntimeMaterialSignature(base)).toBe(
      getTerminalRuntimeMaterialSignature(changedVolatile),
    );
  });

  it("preserves fields that change operational posture or command evidence", () => {
    const material = projectTerminalRuntimeMaterial(base);

    expect(material).toEqual({
      activeRegisterSession: {
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "local-register-1",
        status: "active",
      },
      appSessionRecovery: { status: "recovering" },
      appUpdate: {
        commandExecutionId: "execution-1",
        status: "applying",
      },
      drawerAuthority: {
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "local-register-1",
        status: "healthy",
      },
      localStore: {
        available: true,
        terminalSeedReady: true,
      },
      saleAuthority: { status: "ready" },
      staffAuthority: { staffProfileId: "staff-1", status: "ready" },
      sync: {
        reviewEventCount: 0,
        status: "idle",
      },
      terminalIntegrity: { status: "healthy" },
    });

    expect(
      getTerminalRuntimeMaterialSignature({
        ...base,
        sync: { ...base.sync, status: "needs_review" },
      }),
    ).not.toBe(getTerminalRuntimeMaterialSignature(base));
    expect(
      getTerminalRuntimeMaterialSignature({
        ...base,
        staffAuthority: {
          ...base.staffAuthority,
          staffProfileId: "staff-2",
        },
      }),
    ).not.toBe(getTerminalRuntimeMaterialSignature(base));
  });
});

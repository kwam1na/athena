import { describe, expect, it, vi } from "vitest";

import {
  createUpdateCoordinatorStore,
  type UpdateCoordinatorMessage,
} from "./updateCoordinator";

describe("updateCoordinator", () => {
  it("records update readiness without applying until the operator asks", () => {
    const reload = vi.fn();
    const coordinator = createUpdateCoordinatorStore({
      reload,
      now: () => 1_000,
      tabId: "tab-a",
    });

    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "staged",
    });

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "ready",
      canApply: true,
      pendingBuildId: "build-2",
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps detected but unstaged updates visible while allowing manual apply", () => {
    const reload = vi.fn();
    const coordinator = createUpdateCoordinatorStore({
      reload,
      now: () => 1_000,
      tabId: "tab-a",
    });

    coordinator.reportUpdateDetected({
      assetCount: 17,
      currentBuildId: "build-1",
      failedAssetCount: 0,
      pendingBuildId: "build-2",
      rejectedAssetCount: 0,
      stagingReason: "service-worker-timeout",
      stagingStatus: "unstaged",
    });

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "ready-unstaged",
      canApply: true,
      pendingBuildId: "build-2",
      staging: {
        assetCount: 17,
        failedAssetCount: 0,
        reason: "service-worker-timeout",
        rejectedAssetCount: 0,
        status: "unstaged",
      },
    });
    expect(coordinator.applyUpdate()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("returns a stable snapshot while no store change occurs", () => {
    let now = 1_000;
    const coordinator = createUpdateCoordinatorStore({
      reload: vi.fn(),
      now: () => now,
      tabId: "tab-a",
    });
    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "staged",
    });

    const firstSnapshot = coordinator.getSnapshot();
    now = 2_000;

    expect(coordinator.getSnapshot()).toBe(firstSnapshot);
  });

  it("blocks apply while local blockers are active and reloads once after they clear", () => {
    const reload = vi.fn();
    const coordinator = createUpdateCoordinatorStore({
      reload,
      now: () => 1_000,
      tabId: "tab-a",
    });

    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "staged",
    });
    coordinator.registerApplyBlocker({
      surfaceId: "pos-register",
      priority: "critical-workflow",
      label: "Register sale",
      guidance: "Finish this sale before refreshing.",
    });

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "blocked",
      canApply: false,
      selectedBlocker: {
        surfaceId: "pos-register",
        label: "Register sale",
      },
    });
    expect(coordinator.applyUpdate()).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    coordinator.clearApplyBlocker("pos-register");

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "ready",
      canApply: true,
    });
    expect(coordinator.applyUpdate()).toBe(true);
    expect(coordinator.applyUpdate()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("passes unload bypass options to the reload boundary when requested", () => {
    const reload = vi.fn();
    const coordinator = createUpdateCoordinatorStore({
      reload,
      now: () => 1_000,
      tabId: "tab-a",
    });
    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "staged",
    });

    expect(coordinator.applyUpdate({ bypassUnloadPrompt: true })).toBe(true);

    expect(reload).toHaveBeenCalledWith({ bypassUnloadPrompt: true });
  });

  it("keeps the reload latch active when detection reports again while applying", () => {
    const reload = vi.fn();
    const coordinator = createUpdateCoordinatorStore({
      reload,
      now: () => 1_000,
      tabId: "tab-a",
    });
    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "staged",
    });

    expect(coordinator.applyUpdate()).toBe(true);

    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "unstaged",
    });

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "applying",
      canApply: false,
    });
    expect(coordinator.applyUpdate()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps local blockers authoritative when merging remote tab messages", () => {
    const reload = vi.fn();
    const coordinator = createUpdateCoordinatorStore({
      reload,
      now: () => 10_000,
      tabId: "tab-a",
      remoteBlockerLeaseMs: 5_000,
    });
    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "staged",
    });
    coordinator.registerApplyBlocker({
      surfaceId: "pos-register",
      priority: "critical-workflow",
      label: "Register sale",
      guidance: "Finish this sale before refreshing.",
    });

    coordinator.receiveMessage({
      type: "athena:update-coordinator:v1",
      sourceTabId: "tab-b",
      pendingBuildId: "build-2",
      sentAt: 10_100,
      blockers: [],
    });

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "blocked",
      canApply: false,
      selectedBlocker: {
        surfaceId: "pos-register",
      },
    });
  });

  it("clears app-message synced blockers when the foundation action state clears", () => {
    const coordinator = createUpdateCoordinatorStore({
      reload: vi.fn(),
      now: () => 1_000,
      tabId: "tab-a",
    });

    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "staged",
    });
    coordinator.syncApplyBlockers([
      {
        surfaceId: "pos-register",
        priority: "critical-workflow",
        label: "Register sale",
        guidance: "Finish this sale before refreshing.",
      },
    ]);

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "blocked",
      canApply: false,
      selectedBlocker: {
        surfaceId: "pos-register",
      },
    });

    coordinator.syncApplyBlockers([]);

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "ready",
      canApply: true,
      blockers: [],
    });
  });

  it("expires stale remote blockers with a subscriber notification", () => {
    let now = 10_000;
    const timers: Array<() => void> = [];
    const listener = vi.fn();
    const coordinator = createUpdateCoordinatorStore({
      reload: vi.fn(),
      now: () => now,
      tabId: "tab-a",
      remoteBlockerLeaseMs: 5_000,
      setTimer: (callback) => {
        timers.push(callback);
        return callback;
      },
      clearTimer: vi.fn(),
    });
    coordinator.subscribe(listener);
    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "staged",
    });
    coordinator.receiveMessage({
      type: "athena:update-coordinator:v1",
      sourceTabId: "tab-b",
      pendingBuildId: "build-2",
      sentAt: 10_000,
      blockers: [
        {
          surfaceId: "inventory-import",
          priority: "active-command",
          label: "Inventory import",
          guidance: "Save this import before refreshing.",
          generation: 1,
        },
      ],
    });

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "blocked",
      canApply: false,
    });
    expect(timers).toHaveLength(1);

    now = 16_000;
    timers[0]?.();

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "ready",
      canApply: true,
    });
    expect(listener).toHaveBeenCalled();
  });

  it("ignores malformed or stale-build cross-tab messages", () => {
    const coordinator = createUpdateCoordinatorStore({
      reload: vi.fn(),
      now: () => 1_000,
      tabId: "tab-a",
    });
    coordinator.reportUpdateDetected({
      currentBuildId: "build-1",
      pendingBuildId: "build-2",
      stagingStatus: "staged",
    });

    coordinator.receiveMessage({
      type: "athena:update-coordinator:v1",
      sourceTabId: "tab-b",
      pendingBuildId: "build-3",
      sentAt: 1_000,
      blockers: [
        {
          surfaceId: "inventory-import",
          priority: "critical-workflow",
          label: "Inventory import",
          guidance: "Save this import before refreshing.",
          generation: 1,
        },
      ],
    });
    coordinator.receiveMessage({
      type: "unexpected",
      sourceTabId: "tab-b",
      pendingBuildId: "build-2",
      sentAt: 1_000,
      blockers: [],
    } as unknown as UpdateCoordinatorMessage);

    expect(coordinator.getSnapshot()).toMatchObject({
      status: "ready",
      canApply: true,
      blockers: [],
    });
  });
});

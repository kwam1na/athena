import { describe, expect, it } from "vitest";

import {
  POS_TERMINAL_HEALTH_ALERT_COOLDOWN_MS,
  classifyTerminalHealthAlertConditions,
  resolveTerminalHealthAlertTransitions,
} from "./terminalHealthAlerts";

const healthy = {
  localStore: {
    available: true,
    engineReadiness: "ready" as const,
    ledgerPressure: "normal" as const,
    maintenance: "idle" as const,
    migration: "idle" as const,
    pressure: "normal" as const,
  },
  sync: { heldWithoutProgress: false },
};

const syncStuck = {
  ...healthy,
  sync: { heldWithoutProgress: true },
};

const storageCritical = {
  ...healthy,
  localStore: { ...healthy.localStore, pressure: "critical" as const },
};

describe("classifyTerminalHealthAlertConditions", () => {
  it("returns no conditions for a healthy status", () => {
    expect(classifyTerminalHealthAlertConditions(healthy)).toEqual([]);
  });

  it("flags each storage-critical variant", () => {
    for (const localStore of [
      { ...healthy.localStore, available: false },
      { ...healthy.localStore, engineReadiness: "unavailable" as const },
      { ...healthy.localStore, pressure: "critical" as const },
      { ...healthy.localStore, ledgerPressure: "critical" as const },
      { ...healthy.localStore, migration: "failed" as const },
      { ...healthy.localStore, maintenance: "blocked" as const },
    ]) {
      expect(
        classifyTerminalHealthAlertConditions({ ...healthy, localStore }),
      ).toEqual(["storage_critical"]);
    }
  });

  it("does not flag warning-level pressure", () => {
    expect(
      classifyTerminalHealthAlertConditions({
        ...healthy,
        localStore: { ...healthy.localStore, pressure: "warning" },
      }),
    ).toEqual([]);
  });

  it("flags a stuck sync", () => {
    expect(classifyTerminalHealthAlertConditions(syncStuck)).toEqual([
      "sync_stuck",
    ]);
  });
});

describe("resolveTerminalHealthAlertTransitions", () => {
  it("alerts on entry into a degraded condition", () => {
    const result = resolveTerminalHealthAlertTransitions({
      previous: healthy,
      next: syncStuck,
      now: 10_000,
    });

    expect(result.conditionsToAlert).toEqual(["sync_stuck"]);
    expect(result.healthAlerts).toEqual({ sync_stuck: 10_000 });
  });

  it("alerts on the first heartbeat when it is already degraded", () => {
    const result = resolveTerminalHealthAlertTransitions({
      previous: null,
      next: storageCritical,
      now: 10_000,
    });

    expect(result.conditionsToAlert).toEqual(["storage_critical"]);
  });

  it("does not re-alert while a condition persists", () => {
    const result = resolveTerminalHealthAlertTransitions({
      previous: { ...syncStuck, healthAlerts: { sync_stuck: 5_000 } },
      next: syncStuck,
      now: 10_000,
    });

    expect(result.conditionsToAlert).toEqual([]);
    expect(result.healthAlerts).toBeUndefined();
  });

  it("suppresses re-entry within the cooldown window (flapping)", () => {
    const result = resolveTerminalHealthAlertTransitions({
      previous: { ...healthy, healthAlerts: { sync_stuck: 5_000 } },
      next: syncStuck,
      now: 5_000 + POS_TERMINAL_HEALTH_ALERT_COOLDOWN_MS - 1,
    });

    expect(result.conditionsToAlert).toEqual([]);
  });

  it("alerts again on re-entry after the cooldown window", () => {
    const now = 5_000 + POS_TERMINAL_HEALTH_ALERT_COOLDOWN_MS;
    const result = resolveTerminalHealthAlertTransitions({
      previous: { ...healthy, healthAlerts: { sync_stuck: 5_000 } },
      next: syncStuck,
      now,
    });

    expect(result.conditionsToAlert).toEqual(["sync_stuck"]);
    expect(result.healthAlerts).toEqual({ sync_stuck: now });
  });

  it("preserves other conditions' alert timestamps when stamping a new one", () => {
    const result = resolveTerminalHealthAlertTransitions({
      previous: { ...syncStuck, healthAlerts: { sync_stuck: 5_000 } },
      next: { ...storageCritical, sync: { heldWithoutProgress: true } },
      now: 10_000,
    });

    expect(result.conditionsToAlert).toEqual(["storage_critical"]);
    expect(result.healthAlerts).toEqual({
      sync_stuck: 5_000,
      storage_critical: 10_000,
    });
  });
});

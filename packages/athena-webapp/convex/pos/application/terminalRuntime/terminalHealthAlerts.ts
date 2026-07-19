import type { Doc } from "../../../_generated/dataModel";

/**
 * Edge-triggered terminal health alerting.
 *
 * Alert decisions run entirely on data already in memory at heartbeat-write
 * time (the previous runtime-status row is read by the upsert regardless), so
 * classification and transition detection cost zero additional database reads.
 * The per-condition `healthAlerts` timestamps ride on the runtime-status row
 * itself — no separate alert-state table to read — and suppress flapping via a
 * cooldown window.
 */

export const POS_TERMINAL_HEALTH_ALERT_CONDITIONS = [
  "storage_critical",
  "sync_stuck",
] as const;

export type PosTerminalHealthAlertCondition =
  (typeof POS_TERMINAL_HEALTH_ALERT_CONDITIONS)[number];

export const POS_TERMINAL_HEALTH_ALERT_COOLDOWN_MS = 6 * 60 * 60_000;

type RuntimeStatusHealthSource = {
  localStore: Pick<
    Doc<"posTerminalRuntimeStatus">["localStore"],
    | "available"
    | "engineReadiness"
    | "ledgerPressure"
    | "maintenance"
    | "migration"
    | "pressure"
  >;
  sync: Pick<Doc<"posTerminalRuntimeStatus">["sync"], "heldWithoutProgress">;
};

export function classifyTerminalHealthAlertConditions(
  status: RuntimeStatusHealthSource,
): PosTerminalHealthAlertCondition[] {
  const conditions: PosTerminalHealthAlertCondition[] = [];
  const localStore = status.localStore;
  if (
    localStore.available === false ||
    localStore.engineReadiness === "unavailable" ||
    localStore.pressure === "critical" ||
    localStore.ledgerPressure === "critical" ||
    localStore.migration === "failed" ||
    localStore.maintenance === "blocked"
  ) {
    conditions.push("storage_critical");
  }
  if (status.sync.heldWithoutProgress === true) {
    conditions.push("sync_stuck");
  }
  return conditions;
}

export function resolveTerminalHealthAlertTransitions(input: {
  previous:
    | (RuntimeStatusHealthSource & {
        healthAlerts?: Record<string, number>;
      })
    | null;
  next: RuntimeStatusHealthSource;
  now: number;
}): {
  conditionsToAlert: PosTerminalHealthAlertCondition[];
  healthAlerts?: Record<string, number>;
} {
  const previousConditions = new Set(
    input.previous ? classifyTerminalHealthAlertConditions(input.previous) : [],
  );
  const carriedAlerts = input.previous?.healthAlerts ?? {};
  const conditionsToAlert = classifyTerminalHealthAlertConditions(
    input.next,
  ).filter((condition) => {
    // Edge trigger: alert only on entry into a condition, and only when the
    // last alert for that condition (if any) is outside the cooldown window.
    if (previousConditions.has(condition)) {
      return false;
    }
    const lastAlertedAt = carriedAlerts[condition];
    return (
      lastAlertedAt === undefined ||
      input.now - lastAlertedAt >= POS_TERMINAL_HEALTH_ALERT_COOLDOWN_MS
    );
  });

  if (conditionsToAlert.length === 0) {
    return { conditionsToAlert };
  }

  const healthAlerts = { ...carriedAlerts };
  for (const condition of conditionsToAlert) {
    healthAlerts[condition] = input.now;
  }
  return { conditionsToAlert, healthAlerts };
}

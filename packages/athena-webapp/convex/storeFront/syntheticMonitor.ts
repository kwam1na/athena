export const SYNTHETIC_MONITOR_ORIGIN = "synthetic_monitor";

export function isSyntheticMonitorOrigin(origin?: string | null) {
  return origin === SYNTHETIC_MONITOR_ORIGIN;
}

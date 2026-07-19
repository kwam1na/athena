/**
 * In-memory counters for best-effort rails that deliberately swallow errors
 * (storage probes, leader-election coordination, migrations). The rails keep
 * their swallow semantics; the counters make the swallowing visible in the
 * terminal runtime heartbeat instead of leaving degradation indistinguishable
 * from health. Counts are per page lifetime and reported as running totals.
 */

const counters = new Map<string, number>();

export function incrementPosRuntimeCounter(name: string): void {
  try {
    counters.set(name, (counters.get(name) ?? 0) + 1);
  } catch {
    // Counting must never break the rail it observes.
  }
}

export function snapshotPosRuntimeCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function resetPosRuntimeCounters(): void {
  counters.clear();
}

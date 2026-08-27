/**
 * In-memory counters for best-effort rails that deliberately swallow errors
 * (storage probes, leader-election coordination, migrations). The rails keep
 * their swallow semantics; the counters make the swallowing visible in the
 * terminal runtime heartbeat instead of leaving degradation indistinguishable
 * from health. Counts are per page lifetime and reported as running totals.
 */

const counters = new Map<string, number>();
const listeners = new Set<() => void>();
let revision = 0;

function publishCounterChange(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export function incrementPosRuntimeCounter(name: string): void {
  try {
    counters.set(name, (counters.get(name) ?? 0) + 1);
    publishCounterChange();
  } catch {
    // Counting must never break the rail it observes.
  }
}

export function setPosRuntimeCounter(name: string, value: number): void {
  try {
    if (!Number.isFinite(value) || value < 0) return;
    const normalized = Math.floor(value);
    if (counters.get(name) === normalized) return;
    counters.set(name, normalized);
    publishCounterChange();
  } catch {
    // Gauges must never break the rail they observe.
  }
}

export function initializePosRuntimeCounter(name: string): void {
  try {
    if (counters.has(name)) return;
    counters.set(name, 0);
    publishCounterChange();
  } catch {
    // Initialization must never break the rail it observes.
  }
}

export function subscribePosRuntimeCounters(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPosRuntimeCounterRevision(): number {
  return revision;
}

export function snapshotPosRuntimeCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function resetPosRuntimeCounters(): void {
  if (counters.size === 0) return;
  counters.clear();
  publishCounterChange();
}

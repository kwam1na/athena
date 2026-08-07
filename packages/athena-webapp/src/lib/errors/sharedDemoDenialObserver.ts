/**
 * A one-slot seam for noticing that the shared demo refused an action.
 *
 * The refusal is only observable in the browser: a denied admission throws,
 * and a Convex mutation throw rolls back every write in its transaction, so
 * the server cannot record its own denial. `runCommand` already normalizes the
 * demo denial for presentation, and it is the single place every command
 * failure passes through — but it must stay browser-safe and free of Convex
 * imports, so it notifies through here instead of emitting directly.
 */
type SharedDemoDenialObserver = () => void;

let observer: SharedDemoDenialObserver | null = null;

export function setSharedDemoDenialObserver(
  next: SharedDemoDenialObserver,
): () => void {
  observer = next;
  return () => {
    if (observer === next) observer = null;
  };
}

export function notifySharedDemoDenial() {
  try {
    observer?.();
  } catch {
    // Observing a denial must never turn into a second failure on top of the
    // one the visitor is already being shown.
  }
}

/** Shared rollout configuration without importing report workers or admission. */
export const REPORTS_SWEEP_STORE_ALLOWLIST_ENV =
  "REPORTS_SWEEP_STORE_ALLOWLIST";

/** Empty/unset allows nothing. */
export function parseStoreAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function readStoreAllowlist(): Set<string> {
  return parseStoreAllowlist(process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV]);
}

import { capitalizeWords } from "./textCase";

/**
 * Display normalization for frozen product identity.
 *
 * Reports and email both render product names frozen into an immutable
 * snapshot, so the stored value keeps whatever the source recorded and the
 * tidying happens on read. It lives here because both surfaces must reach the
 * same result — the moment each decides for itself, they drift.
 */
export function formatProductDisplayName(name: string): string {
  return capitalizeWords(name.trim().replace(/\s+/g, " "));
}

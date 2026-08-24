import { isSharedDemoSessionExpiredData } from "~/shared/sharedDemoActionError";

/**
 * How an expired demo session announced itself before it carried a code.
 *
 * Kept as a fallback, not as the primary test: Convex forwards the message of
 * a plain `Error` only outside production, so this pattern matches on a
 * developer's machine and never in the deployed app. Anything that depends on
 * recognizing expiry must go through the code path above it.
 */
const LEGACY_EXPIRED_MESSAGE_PATTERN = /(?:shared )?demo session has expired/i;

export function isSharedDemoSessionExpiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  if (
    "data" in error &&
    isSharedDemoSessionExpiredData((error as { data: unknown }).data)
  ) {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" && LEGACY_EXPIRED_MESSAGE_PATTERN.test(message)
  );
}

/**
 * Renewal is automatic, so it needs a stop.
 *
 * If a renewal succeeds but the page still fails, the reload lands back on the
 * same boundary and would renew again — a loop that issues admissions forever
 * and never shows the visitor anything. The counter is per-tab and is cleared
 * the moment a demo page renders, so a genuine expiry hours later still gets
 * its automatic retry.
 */
const RENEWAL_ATTEMPT_KEY = "athena.sharedDemo.renewalAttempts";
export const MAX_SHARED_DEMO_RENEWAL_ATTEMPTS = 2;

/**
 * Session storage, with an in-memory stand-in when it is unavailable.
 *
 * Storage can be absent or throw — Safari in private browsing is the common
 * case, and partitioned storage in an embedded context is another.
 *
 * Be precise about what the memory half does and does not buy: it holds the
 * count for the life of a page, but the loop this caps is renew -> RELOAD ->
 * renew, and a reload wipes module state. So when storage is unavailable the
 * cap is per-page-load rather than per-tab, and the cross-reload backstop is
 * the server's own admission rate budget (`sharedDemo/admission.ts`), which
 * refuses to keep minting. Memory is still worth keeping: it is what makes
 * the cap hold within a page, including in environments where a written key
 * reads back empty.
 */
let memoryAttempts = 0;

function readStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function countSharedDemoRenewalAttempts(): number {
  // The higher of the two, never one or the other. Memory is authoritative
  // within a page — storage can be present but inert, and trusting it alone
  // reads back zero and uncaps the loop. Storage is what survives the reload
  // the renewal performs, which is the only reason it is consulted at all.
  return Math.max(memoryAttempts, readStoredAttempts());
}

function readStoredAttempts(): number {
  try {
    const parsed = Number(readStore()?.getItem(RENEWAL_ATTEMPT_KEY) ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function recordSharedDemoRenewalAttempt(): number {
  const next = countSharedDemoRenewalAttempts() + 1;
  memoryAttempts = next;
  try {
    readStore()?.setItem(RENEWAL_ATTEMPT_KEY, String(next));
  } catch {
    // Memory already holds it.
  }
  return next;
}

export function clearSharedDemoRenewalAttempts(): void {
  memoryAttempts = 0;
  try {
    readStore()?.removeItem(RENEWAL_ATTEMPT_KEY);
  } catch {
    // Memory already cleared.
  }
}

export function canRenewSharedDemoSession(): boolean {
  return countSharedDemoRenewalAttempts() < MAX_SHARED_DEMO_RENEWAL_ATTEMPTS;
}

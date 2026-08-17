import { MARKER_KEY } from "@/lib/constants";

/**
 * The guest session-recovery MARKER.
 *
 * The storefront sends this to the two bootstrap routes (`GET /storefront`,
 * `GET /guests`) so a shopper whose `guest_id` cookie is gone can be handed
 * their previous guest session back. Because the server answers a matching
 * marker with a SIGNED guest cookie, presenting the right marker is the same
 * as holding the session — so the marker has to be unguessable, and the server
 * refuses to look up anything shorter than 22 characters.
 *
 * It is therefore minted with `crypto.randomUUID()` (36 characters, 122 bits
 * of randomness), never `Math.random()`. A stored value that does not have
 * that shape — the ~5-character markers older builds kept — is not a usable
 * marker: it is replaced rather than sent, so this browser recovers nothing
 * from it and simply starts a fresh guest session on its next bootstrap.
 */
const RECOVERABLE_MARKER = /^[A-Za-z0-9_-]{22,128}$/;

export function getOrCreateGuestMarker(): string {
  const stored = localStorage.getItem(MARKER_KEY);
  if (stored && RECOVERABLE_MARKER.test(stored)) return stored;

  const marker = crypto.randomUUID();
  localStorage.setItem(MARKER_KEY, marker);
  return marker;
}

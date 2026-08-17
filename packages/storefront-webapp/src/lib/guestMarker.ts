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
 * It is therefore minted from the CSPRNG — `crypto.randomUUID()` (36
 * characters, 122 bits of randomness) where it exists, and 128 bits from
 * `crypto.getRandomValues` as 32 hex characters where it does not
 * (`randomUUID` is secure-context-only and missing from older WebKit; this
 * mint runs on the store-bootstrap critical path, so a missing API must not
 * take the storefront down). Never `Math.random()`: the server refuses that
 * shape by design. A stored value that does not have the recoverable shape —
 * the ~5-character markers older builds kept — is not a usable marker: it is
 * replaced rather than sent, so this browser recovers nothing from it and
 * simply starts a fresh guest session on its next bootstrap.
 */
const RECOVERABLE_MARKER = /^[A-Za-z0-9_-]{22,128}$/;

export function getOrCreateGuestMarker(): string {
  const stored = localStorage.getItem(MARKER_KEY);
  if (stored && RECOVERABLE_MARKER.test(stored)) return stored;

  const marker = mintGuestMarker();
  localStorage.setItem(MARKER_KEY, marker);
  return marker;
}

function mintGuestMarker(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

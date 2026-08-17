/**
 * Signed storefront session cookies.
 *
 * WHY THIS EXISTS
 *
 * A `guest_id` cookie is caller-supplied text. For three review rounds the
 * guest→account merge was "fixed" while the guest side of it stayed entirely
 * caller-chosen: first a body field, then a cookie compared against itself,
 * then a cookie the sign-in route trusted enough to MINT a merge grant from.
 * Every one of those is the same bug — the server had no way to tell a guest
 * session it issued to THIS browser from a guest id somebody typed.
 *
 * This module is that way. The two bootstrap routes mint `guest_id` as
 * `<id>.<hmac>`, and every consumer accepts the id only when the HMAC
 * verifies. An unsigned or tampered cookie is ABSENT, never an error: a
 * shopper with a stale cookie is a shopper to re-bootstrap, not a fault to
 * page on.
 *
 * WHY A HAND-ROLLED HMAC RATHER THAN `hono/cookie`'s SIGNED COOKIES
 *
 * `setSignedCookie` / `getSignedCookie` are async (they go through
 * `crypto.subtle`). The mint points could await them, but verification also
 * has to happen inside `getStorefrontClaimFromRequest`, which the admission
 * rail calls SYNCHRONOUSLY (`extractIngressClaim: (c: Context) => claim`), and
 * the rail core is out of this change's blast radius. So the primitive here is
 * a synchronous SHA-256/HMAC over `Uint8Array`, usable identically from the
 * HTTP ingress path and from the admission adapter's mutation context.
 *
 * The comparison is CONSTANT-TIME. Verification must never be a plain `===`
 * on attacker-influenced input — that is the same class of mistake as the
 * cookie-compared-against-itself round.
 */

export const STOREFRONT_COOKIE_SECRET_ENV = "ATHENA_STOREFRONT_COOKIE_SECRET";

/** The one cookie this change signs. `user_id` is deliberately still bearer. */
export const GUEST_COOKIE_NAME = "guest_id";

/**
 * The signature carried alongside `guestId` on the admission ingress claim.
 *
 * It travels as a separate field rather than being folded into the id so the
 * claim's `guestId` stays a real `Id<"guest">` for every existing reader,
 * while the adapter can still RE-VERIFY instead of trusting that the ingress
 * extractor ran. Two independent checks of the same secret, no shared mutable
 * state between them.
 */
export type SignedGuestClaimFields = { guestIdSignature?: string };

type Environment = Record<string, string | undefined>;

/**
 * The signing secret, or `undefined` when unconfigured.
 *
 * FAIL CLOSED: every caller treats `undefined` as "no guest session can be
 * issued or accepted". It deliberately does NOT throw — an unconfigured
 * environment must still serve anonymous catalog browse (routes whose
 * definition says `public: "admit"` never look at a guest cookie at all).
 * Only the guest-IDENTIFIED paths go dark.
 */
export function readStorefrontCookieSecret(
  environment: Environment = process.env,
): string | undefined {
  const raw = environment[STOREFRONT_COOKIE_SECRET_ENV];
  if (typeof raw !== "string") return undefined;
  const secret = raw.trim();
  return secret.length > 0 ? secret : undefined;
}

/** `<value>.<hex hmac>`. The separator never occurs in a Convex id. */
const SIGNATURE_SEPARATOR = ".";

/**
 * The signed payload binds the COOKIE NAME to the value, so a signature minted
 * for one cookie cannot be replayed into another (a `user_id` signature is not
 * a `guest_id` signature).
 */
function signaturePayload(name: string, value: string) {
  return `${name}.${value}`;
}

export function signStorefrontCookieValue(
  name: string,
  value: string,
  secret: string,
): string {
  return `${value}${SIGNATURE_SEPARATOR}${hmacSha256Hex(secret, signaturePayload(name, value))}`;
}

/**
 * Split a presented cookie into its value and signature.
 *
 * A value with no separator is a LEGACY UNSIGNED cookie — a distinct case from
 * a bad signature, because exactly one place in the system (bootstrap) is
 * allowed to upgrade it.
 */
export function splitSignedStorefrontCookieValue(
  raw: string | undefined,
): { value: string; signature: string } | undefined {
  if (typeof raw !== "string") return undefined;
  const index = raw.lastIndexOf(SIGNATURE_SEPARATOR);
  if (index <= 0 || index === raw.length - 1) return undefined;
  return { value: raw.slice(0, index), signature: raw.slice(index + 1) };
}

/** True when the presented cookie carries no signature at all. */
export function isUnsignedStorefrontCookieValue(
  raw: string | undefined,
): boolean {
  return typeof raw === "string" && raw.length > 0 && !splitSignedStorefrontCookieValue(raw);
}

/**
 * The signed value's payload, or `undefined` when the signature is missing,
 * malformed or wrong. Never throws, never distinguishes the failures to the
 * caller.
 */
export function verifyStorefrontCookieValue(
  name: string,
  raw: string | undefined,
  secret: string | undefined,
): string | undefined {
  if (!secret) return undefined;
  const parts = splitSignedStorefrontCookieValue(raw);
  if (!parts) return undefined;
  const expected = hmacSha256Hex(secret, signaturePayload(name, parts.value));
  return constantTimeEquals(parts.signature, expected) ? parts.value : undefined;
}

/**
 * Verify a detached signature carried alongside a value (the shape the
 * admission claim uses, where the id and its signature travel as separate
 * fields through the rail).
 */
export function verifyStorefrontCookieSignature(
  name: string,
  value: string | undefined,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !value || !signature) return false;
  return constantTimeEquals(
    signature,
    hmacSha256Hex(secret, signaturePayload(name, value)),
  );
}

/** The detached signature for a value already known to be server-issued. */
export function storefrontCookieSignature(
  name: string,
  value: string,
  secret: string,
): string {
  return hmacSha256Hex(secret, signaturePayload(name, value));
}

/**
 * Length-independent, content-constant-time string comparison.
 *
 * Both operands here are fixed-width hex digests, so the length check leaks
 * nothing; the byte loop is what keeps a wrong signature from being
 * distinguishable by how early it differs.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/* ------------------------------------------------------------------------ *
 * Synchronous HMAC-SHA-256.
 *
 * Textbook FIPS 180-4 / RFC 2104. It is here rather than borrowed from
 * `crypto.subtle` only because the admission rail's claim extractor is
 * synchronous; the values it protects are short and the call is once per
 * request.
 * ------------------------------------------------------------------------ */

const SHA256_BLOCK_BYTES = 64;

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function sha256(message: Uint8Array): Uint8Array {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  // Padding is exact, not merely sufficient: 0x80, then the fewest zeros that
  // leave room for a 64-bit big-endian bit length in a whole number of blocks.
  const paddedLength =
    Math.ceil((message.length + 9) / SHA256_BLOCK_BYTES) * SHA256_BLOCK_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += SHA256_BLOCK_BYTES) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous = schedule[index - 15];
      const ahead = schedule[index - 2];
      const s0 =
        (rotateRight(previous, 7) ^
          rotateRight(previous, 18) ^
          (previous >>> 3)) >>>
        0;
      const s1 =
        (rotateRight(ahead, 17) ^ rotateRight(ahead, 19) ^ (ahead >>> 10)) >>> 0;
      schedule[index] =
        (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;

    for (let index = 0; index < 64; index += 1) {
      const S1 =
        (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[index] + schedule[index]) >>> 0;
      const S0 =
        (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let index = 0; index < 8; index += 1) {
    digestView.setUint32(index * 4, state[index]);
  }
  return digest;
}

function hmacSha256(secret: string, message: string): Uint8Array {
  const encoder = new TextEncoder();
  const rawKey = encoder.encode(secret);
  const key = new Uint8Array(SHA256_BLOCK_BYTES);
  key.set(rawKey.length > SHA256_BLOCK_BYTES ? sha256(rawKey) : rawKey);

  const messageBytes = encoder.encode(message);

  const inner = new Uint8Array(SHA256_BLOCK_BYTES + messageBytes.length);
  for (let index = 0; index < SHA256_BLOCK_BYTES; index += 1) {
    inner[index] = key[index] ^ 0x36;
  }
  inner.set(messageBytes, SHA256_BLOCK_BYTES);

  const outer = new Uint8Array(SHA256_BLOCK_BYTES + 32);
  for (let index = 0; index < SHA256_BLOCK_BYTES; index += 1) {
    outer[index] = key[index] ^ 0x5c;
  }
  outer.set(sha256(inner), SHA256_BLOCK_BYTES);

  return sha256(outer);
}

export function hmacSha256Hex(secret: string, message: string): string {
  return Array.from(hmacSha256(secret, message), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

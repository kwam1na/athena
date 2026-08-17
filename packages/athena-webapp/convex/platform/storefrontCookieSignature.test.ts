// @vitest-environment node

/**
 * The signing primitive under the storefront guest cookie.
 *
 * The HMAC is hand-rolled (the admission rail's claim extractor is
 * synchronous, so `crypto.subtle` is not available to it), which means its
 * correctness has to be pinned by VECTORS rather than by "it round-trips" —
 * a broken hash round-trips against itself perfectly. The digests below are
 * RFC 4231's HMAC-SHA-256 test cases.
 */

import { describe, expect, it, vi } from "vitest";

import {
  GUEST_COOKIE_NAME,
  STOREFRONT_COOKIE_SECRET_ENV,
  constantTimeEquals,
  hmacSha256Hex,
  isUnsignedStorefrontCookieValue,
  readStorefrontCookieSecret,
  signStorefrontCookieValue,
  storefrontCookieSignature,
  verifyStorefrontCookieSignature,
  verifyStorefrontCookieValue,
} from "./storefrontCookieSignature";

describe("HMAC-SHA-256", () => {
  it("matches the RFC 4231 vectors", () => {
    // Case 2.
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
    // The empty key / empty message edge.
    expect(hmacSha256Hex("", "")).toBe(
      "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad",
    );
    // A key longer than the 64-byte block, which must be hashed down first.
    // (RFC 4231 case 6 in shape; the digest is Node's `createHmac` on the same
    // inputs, since this API takes a UTF-8 string rather than raw bytes.)
    expect(
      hmacSha256Hex(
        "k".repeat(131),
        "Test Using Larger Than Block-Size Key - Hash Key First",
      ),
    ).toBe("70e4b005732fa7ff79392aa24fb240159b925dbc9f1398420c0f45e6763dcf14");
  });

  it("handles the message lengths around a block boundary", () => {
    // 55/56/64 bytes are where padding either does or does not need an extra
    // block — the classic place a hand-written SHA-256 goes wrong.
    expect(hmacSha256Hex("k", "y".repeat(55))).toHaveLength(64);
    expect(hmacSha256Hex("k", "y".repeat(55))).not.toBe(
      hmacSha256Hex("k", "y".repeat(56)),
    );
    expect(hmacSha256Hex("k", "y".repeat(64))).not.toBe(
      hmacSha256Hex("k", "y".repeat(65)),
    );
  });
});

describe("storefront cookie signing", () => {
  const SECRET = "test-storefront-cookie-secret";

  it("round-trips a value it signed", () => {
    const signed = signStorefrontCookieValue(GUEST_COOKIE_NAME, "guest-1", SECRET);

    expect(signed).not.toBe("guest-1");
    expect(verifyStorefrontCookieValue(GUEST_COOKIE_NAME, signed, SECRET)).toBe(
      "guest-1",
    );
  });

  it("refuses an unsigned, tampered, cross-named or foreign-secret value", () => {
    const signed = signStorefrontCookieValue(GUEST_COOKIE_NAME, "guest-1", SECRET);

    const rejected = [
      // Legacy / forged: no signature at all.
      "guest-1",
      // The signature of a DIFFERENT guest, pasted onto this one.
      `guest-2.${signed.split(".")[1]}`,
      // A signature minted for another cookie name is not reusable here.
      signStorefrontCookieValue("user_id", "guest-1", SECRET),
      // Truncated and empty signatures.
      `guest-1.`,
      `guest-1.${"0".repeat(64)}`,
    ];

    for (const value of rejected) {
      expect({
        value,
        result: verifyStorefrontCookieValue(GUEST_COOKIE_NAME, value, SECRET),
      }).toEqual({ value, result: undefined });
    }

    // A different secret cannot verify either.
    expect(
      verifyStorefrontCookieValue(GUEST_COOKIE_NAME, signed, "other-secret"),
    ).toBeUndefined();
  });

  it("fails closed with no secret", () => {
    const signed = signStorefrontCookieValue(GUEST_COOKIE_NAME, "guest-1", SECRET);

    expect(
      verifyStorefrontCookieValue(GUEST_COOKIE_NAME, signed, undefined),
    ).toBeUndefined();
    expect(
      verifyStorefrontCookieSignature(
        GUEST_COOKIE_NAME,
        "guest-1",
        storefrontCookieSignature(GUEST_COOKIE_NAME, "guest-1", SECRET),
        undefined,
      ),
    ).toBe(false);
  });

  it("distinguishes a LEGACY unsigned cookie from a signed one", () => {
    // Only the unsigned shape is eligible for the bootstrap upgrade; a bad
    // signature is tampering and must never be upgraded.
    expect(isUnsignedStorefrontCookieValue("guest-1")).toBe(true);
    expect(
      isUnsignedStorefrontCookieValue(
        signStorefrontCookieValue(GUEST_COOKIE_NAME, "guest-1", SECRET),
      ),
    ).toBe(false);
    expect(isUnsignedStorefrontCookieValue("guest-1.deadbeef")).toBe(false);
    expect(isUnsignedStorefrontCookieValue(undefined)).toBe(false);
    expect(isUnsignedStorefrontCookieValue("")).toBe(false);
  });

  it("verifies the detached signature the admission claim carries", () => {
    const signature = storefrontCookieSignature(
      GUEST_COOKIE_NAME,
      "guest-1",
      SECRET,
    );

    expect(
      verifyStorefrontCookieSignature(
        GUEST_COOKIE_NAME,
        "guest-1",
        signature,
        SECRET,
      ),
    ).toBe(true);
    expect(
      verifyStorefrontCookieSignature(
        GUEST_COOKIE_NAME,
        "guest-2",
        signature,
        SECRET,
      ),
    ).toBe(false);
    expect(
      verifyStorefrontCookieSignature(
        GUEST_COOKIE_NAME,
        "guest-1",
        undefined,
        SECRET,
      ),
    ).toBe(false);
  });

  it("compares without an early exit on the first differing byte", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });

  it("treats an unset or blank secret as unconfigured", () => {
    expect(readStorefrontCookieSecret({})).toBeUndefined();
    expect(
      readStorefrontCookieSecret({ [STOREFRONT_COOKIE_SECRET_ENV]: "   " }),
    ).toBeUndefined();
    expect(
      readStorefrontCookieSecret({ [STOREFRONT_COOKIE_SECRET_ENV]: SECRET }),
    ).toBe(SECRET);
  });

  it("reads `process.env` by default", () => {
    vi.stubEnv(STOREFRONT_COOKIE_SECRET_ENV, SECRET);
    try {
      expect(readStorefrontCookieSecret()).toBe(SECRET);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

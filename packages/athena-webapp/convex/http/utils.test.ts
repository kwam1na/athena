import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  GUEST_COOKIE_NAME,
  STOREFRONT_COOKIE_SECRET_ENV,
  sha256Hex,
  signStorefrontCookieValue,
} from "../platform/storefrontCookieSignature";
import { getStorefrontClaimFromRequest } from "./utils";

// The extractor must not hash a value that is not shaped like a minted token.
// That is a claim about a call, not about a return value, so the real digest
// is wrapped rather than replaced.
vi.mock("../platform/storefrontCookieSignature", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../platform/storefrontCookieSignature")
    >();
  return { ...actual, sha256Hex: vi.fn(actual.sha256Hex) };
});

const SIGNING_SECRET = "test-storefront-cookie-secret";
const TOKEN = `athcat_${"A".repeat(43)}`;

/**
 * The extractor runs inside a Hono handler, so the tests drive a real router
 * rather than a hand-built context: cookie parsing and header lookup are the
 * behaviour under test.
 */
async function claimFor(headers: Record<string, string>) {
  const app = new Hono();
  const seen: unknown[] = [];
  app.get("/x", (c) => {
    seen.push(getStorefrontClaimFromRequest(c));
    return c.json({ ok: true });
  });
  await app.request("http://api.test/x", { headers });
  return seen[0];
}

describe("ingress claim extraction", () => {
  it("carries the token hash alone when no cookie is present", async () => {
    expect(await claimFor({ "X-Assistant-Token": TOKEN })).toEqual({
      catalogAccessTokenHash: sha256Hex(new TextEncoder().encode(TOKEN)),
    });
  });

  it("hashes the exact header value, lowercase hex", async () => {
    const claim = (await claimFor({ "X-Assistant-Token": TOKEN })) as {
      catalogAccessTokenHash: string;
    };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(TOKEN),
    );
    expect(claim.catalogAccessTokenHash).toBe(
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    );
  });

  it("ignores a header that is not a minted token, without hashing it", async () => {
    vi.mocked(sha256Hex).mockClear();
    for (const value of [
      "",
      "athcat_",
      "athcat_short",
      `athcat_${"A".repeat(42)}`,
      `athcat_${"A".repeat(44)}`,
      `athcat_${"A".repeat(42)}+`,
      // Surrounding whitespace is stripped by header parsing itself, before
      // this code sees the value, so it is not in this list.
      `Bearer ${TOKEN}`,
      "not-a-token",
    ]) {
      expect([value, await claimFor({ "X-Assistant-Token": value })]).toEqual([
        value,
        undefined,
      ]);
    }
    expect(vi.mocked(sha256Hex)).not.toHaveBeenCalled();

    await claimFor({ "X-Assistant-Token": TOKEN });
    expect(vi.mocked(sha256Hex)).toHaveBeenCalledTimes(1);
  });

  it("adds the token hash alongside a cookie claim without disturbing it", async () => {
    vi.stubEnv(STOREFRONT_COOKIE_SECRET_ENV, SIGNING_SECRET);
    const guestCookie = signStorefrontCookieValue(
      GUEST_COOKIE_NAME,
      "guest_1",
      SIGNING_SECRET,
    );

    const withToken = await claimFor({
      "X-Assistant-Token": TOKEN,
      Cookie: `user_id=user_1; store_id=store_1; ${GUEST_COOKIE_NAME}=${guestCookie}`,
    });
    const withoutToken = await claimFor({
      Cookie: `user_id=user_1; store_id=store_1; ${GUEST_COOKIE_NAME}=${guestCookie}`,
    });

    expect(withToken).toEqual({
      ...(withoutToken as Record<string, unknown>),
      catalogAccessTokenHash: sha256Hex(new TextEncoder().encode(TOKEN)),
    });
    vi.unstubAllEnvs();
  });

  it("still yields no claim at all when neither cookie nor token is present", async () => {
    expect(await claimFor({})).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  isExcludedFromPosAppShellCache,
  isPosAppShellNavigationRequest,
  isPosAppShellRoutePath,
  isPosAppShellStaticAssetRequest,
} from "./posAppShellRoutes";

const origin = "https://athena.example";

describe("POS app-shell route policy", () => {
  it("matches POS hub and register route paths", () => {
    expect(isPosAppShellRoutePath("/acme/store/main/pos")).toBe(true);
    expect(isPosAppShellRoutePath("/acme/store/main/pos/register")).toBe(true);
    expect(isPosAppShellRoutePath("/acme/store/main/operations")).toBe(false);
  });

  it("allows same-origin POS navigation fallback requests", () => {
    expect(
      isPosAppShellNavigationRequest(
        {
          url: `${origin}/acme/store/main/pos/register`,
          mode: "navigate",
        },
        origin,
      ),
    ).toBe(true);
  });

  it("does not classify non-POS protected routes as POS app-shell fallback", () => {
    expect(
      isPosAppShellNavigationRequest(
        {
          url: `${origin}/acme/store/main/operations/daily-close-history`,
          mode: "navigate",
        },
        origin,
      ),
    ).toBe(false);
  });

  it("excludes Convex and API requests even when they originate from POS routes", () => {
    expect(
      isPosAppShellNavigationRequest(
        {
          url: `${origin}/api/pos/register`,
          mode: "navigate",
        },
        origin,
      ),
    ).toBe(false);

    expect(
      isExcludedFromPosAppShellCache(
        new URL(`${origin}/acme/store/main/pos/convex/query`),
      ),
    ).toBe(true);
  });

  it("allows generated Convex client modules as static shell assets", () => {
    expect(
      isExcludedFromPosAppShellCache(
        new URL(`${origin}/convex/_generated/api.js`),
      ),
    ).toBe(false);
  });

  it("allows same-origin static shell assets but excludes data payloads", () => {
    expect(
      isPosAppShellStaticAssetRequest(
        {
          url: `${origin}/assets/register.js`,
          destination: "script",
        },
        origin,
      ),
    ).toBe(true);

    expect(
      isPosAppShellStaticAssetRequest(
        {
          url: `${origin}/assets/register.json`,
          destination: "script",
        },
        origin,
      ),
    ).toBe(false);
  });

  it("allows production bundle assets when request destination is unavailable", () => {
    expect(
      isPosAppShellStaticAssetRequest(
        {
          url: `${origin}/assets/register-BTL1OY3E.js`,
        },
        origin,
      ),
    ).toBe(true);
  });
});

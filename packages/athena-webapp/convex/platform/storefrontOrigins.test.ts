import { describe, expect, it } from "vitest";

import {
  isAllowedStorefrontOrigin,
  readStorefrontOriginAllowlist,
  STOREFRONT_ALLOWED_ORIGINS_ENV,
} from "./storefrontOrigins";

const withOrigins = (value?: string) => ({
  [STOREFRONT_ALLOWED_ORIGINS_ENV]: value,
});

describe("storefront origin allowlist", () => {
  it("fails closed when unset or empty", () => {
    expect(readStorefrontOriginAllowlist(withOrigins())).toEqual([]);
    expect(isAllowedStorefrontOrigin("https://shop.test", withOrigins())).toBe(
      false,
    );
    expect(isAllowedStorefrontOrigin("https://shop.test", withOrigins(""))).toBe(
      false,
    );
  });

  it("matches exactly, never by prefix or suffix", () => {
    const env = withOrigins("https://shop.test, https://www.shop.test");
    expect(isAllowedStorefrontOrigin("https://shop.test", env)).toBe(true);
    expect(isAllowedStorefrontOrigin("https://www.shop.test", env)).toBe(true);
    expect(isAllowedStorefrontOrigin("https://shop.test.evil.com", env)).toBe(
      false,
    );
    expect(isAllowedStorefrontOrigin("https://evil.com", env)).toBe(false);
  });

  it("denies an absent or opaque origin", () => {
    const env = withOrigins("https://shop.test");
    expect(isAllowedStorefrontOrigin(undefined, env)).toBe(false);
    expect(isAllowedStorefrontOrigin(null, env)).toBe(false);
    expect(isAllowedStorefrontOrigin("null", env)).toBe(false);
    expect(isAllowedStorefrontOrigin("", env)).toBe(false);
  });
});

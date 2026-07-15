import { afterEach, describe, expect, it } from "vitest";
import { isAllowedStorefrontOrigin, resolveAllowedOrigin } from "./cors";

const ADDITIONAL_ENV = "ADDITIONAL_ALLOWED_ORIGINS";
const STAGE_ENV = "STAGE";

afterEach(() => {
  delete process.env[ADDITIONAL_ENV];
  delete process.env[STAGE_ENV];
});

describe("isAllowedStorefrontOrigin", () => {
  it("allows localhost and 127.0.0.1 on any port outside production", () => {
    delete process.env[STAGE_ENV];
    expect(isAllowedStorefrontOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedStorefrontOrigin("http://localhost")).toBe(true);
    expect(isAllowedStorefrontOrigin("http://127.0.0.1:3000")).toBe(true);
  });

  it("blocks localhost in production", () => {
    process.env[STAGE_ENV] = "prod";
    expect(isAllowedStorefrontOrigin("http://localhost:5173")).toBe(false);
    expect(isAllowedStorefrontOrigin("http://127.0.0.1:3000")).toBe(false);
    // First-party origins remain allowed in production.
    expect(isAllowedStorefrontOrigin("https://wigclub.store")).toBe(true);
  });

  it("allows the apex domain and its subdomains", () => {
    expect(isAllowedStorefrontOrigin("https://wigclub.store")).toBe(true);
    expect(isAllowedStorefrontOrigin("https://www.wigclub.store")).toBe(true);
    expect(isAllowedStorefrontOrigin("https://dev.wigclub.store")).toBe(true);
    expect(isAllowedStorefrontOrigin("https://athena.wigclub.store")).toBe(true);
  });

  it("rejects unrelated and look-alike origins", () => {
    expect(isAllowedStorefrontOrigin("https://evil.com")).toBe(false);
    expect(isAllowedStorefrontOrigin("https://wigclub.store.evil.com")).toBe(
      false
    );
    expect(isAllowedStorefrontOrigin("https://notwigclub.store")).toBe(false);
    expect(isAllowedStorefrontOrigin("https://wigclub.store.attacker.io")).toBe(
      false
    );
  });

  it("rejects empty, null, and malformed origins", () => {
    expect(isAllowedStorefrontOrigin(undefined)).toBe(false);
    expect(isAllowedStorefrontOrigin(null)).toBe(false);
    expect(isAllowedStorefrontOrigin("")).toBe(false);
    expect(isAllowedStorefrontOrigin("not-a-url")).toBe(false);
  });

  it("honors the ADDITIONAL_ALLOWED_ORIGINS allowlist for exact matches only", () => {
    process.env[ADDITIONAL_ENV] = "https://partner.example.com, https://foo.dev";
    expect(isAllowedStorefrontOrigin("https://partner.example.com")).toBe(true);
    expect(isAllowedStorefrontOrigin("https://foo.dev")).toBe(true);
    expect(isAllowedStorefrontOrigin("https://sub.partner.example.com")).toBe(
      false
    );
  });
});

describe("resolveAllowedOrigin", () => {
  it("reflects an allowed origin and blocks a disallowed one", () => {
    expect(resolveAllowedOrigin("https://wigclub.store")).toBe(
      "https://wigclub.store"
    );
    expect(resolveAllowedOrigin("https://evil.com")).toBeNull();
    expect(resolveAllowedOrigin(undefined)).toBeNull();
  });
});

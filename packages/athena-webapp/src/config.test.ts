import { describe, expect, it, vi } from "vitest";
import { resolveStoreFrontUrl } from "./config";

describe("resolveStoreFrontUrl", () => {
  it("routes Athena QA to the QA storefront", () => {
    expect(
      resolveStoreFrontUrl({
        origin: "https://athena-qa.wigclub.store",
      }),
    ).toBe("https://qa.wigclub.store");
  });

  it("routes the legacy production Athena host to the production storefront", () => {
    expect(
      resolveStoreFrontUrl({
        origin: "https://athena.wigclub.store",
      }),
    ).toBe("https://wigclub.store");
  });

  it("uses the configured storefront URL on the primary admin host", () => {
    expect(
      resolveStoreFrontUrl({
        configuredUrl: "https://wigclub.store",
        origin: "https://athena-os.app",
      }),
    ).toBe("https://wigclub.store");
  });

  it("warns and falls back when the primary admin host has no configured URL", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveStoreFrontUrl({ origin: "https://athena-os.app" })).toBe(
      "http://localhost:5174",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("VITE_STOREFRONT_URL"),
    );

    warn.mockRestore();
  });

  it("routes local Athena dev to the local storefront dev server", () => {
    expect(
      resolveStoreFrontUrl({
        origin: "http://localhost:5173",
      }),
    ).toBe("http://localhost:5174");
  });

  it("keeps explicit storefront URL configuration when provided", () => {
    expect(
      resolveStoreFrontUrl({
        configuredUrl: "https://preview.example.com/",
        origin: "https://athena-qa.wigclub.store",
      }),
    ).toBe("https://preview.example.com");
  });
});

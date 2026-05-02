import { describe, expect, it } from "vitest";
import { resolveStoreFrontUrl } from "./config";

describe("resolveStoreFrontUrl", () => {
  it("routes Athena QA to the QA storefront", () => {
    expect(
      resolveStoreFrontUrl({
        origin: "https://athena-qa.wigclub.store",
      }),
    ).toBe("https://qa.wigclub.store");
  });

  it("routes production Athena to the production storefront", () => {
    expect(
      resolveStoreFrontUrl({
        origin: "https://athena.wigclub.store",
      }),
    ).toBe("https://wigclub.store");
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

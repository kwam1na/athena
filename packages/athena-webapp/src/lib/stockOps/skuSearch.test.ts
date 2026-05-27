import { describe, expect, it } from "vitest";

import { matchesSkuSearchTerms, normalizeSkuSearchQuery } from "./skuSearch";

describe("skuSearch", () => {
  it("matches exact and prefix text tokens", () => {
    expect(
      matchesSkuSearchTerms(
        ["Mahogany Teakwood", "6N2Y-9W1-PNN", "Home Care"],
        normalizeSkuSearchQuery("teak"),
      ),
    ).toBe(true);
  });

  it("matches typo-tolerant product terms", () => {
    expect(
      matchesSkuSearchTerms(
        ["Mahogany Teakwood", "6N2Y-9W1-PNN", "Home Care"],
        normalizeSkuSearchQuery("mahogny"),
      ),
    ).toBe(true);
  });

  it("matches variant attributes with the shared fuzzy matcher", () => {
    expect(
      matchesSkuSearchTerms(
        ["Closure Wig", "CW-18", "natural black", "Large", 18],
        normalizeSkuSearchQuery("natrual blak"),
      ),
    ).toBe(true);
  });

  it("requires every text query token to match", () => {
    expect(
      matchesSkuSearchTerms(
        ["Hair Bands", "KK38-6C-VHT", "POS quick add"],
        normalizeSkuSearchQuery("hair bands"),
      ),
    ).toBe(true);

    expect(
      matchesSkuSearchTerms(
        ["12 Pieces Butterfly Plastic Clamps", "KK38-64H-WTB", "Hair Accessories"],
        normalizeSkuSearchQuery("hair bands"),
      ),
    ).toBe(false);
  });

  it("keeps barcode-shaped searches exact", () => {
    expect(
      matchesSkuSearchTerms(
        ["Yizia Wax & Mud", "KK38-721-WBJ", "111222333444"],
        normalizeSkuSearchQuery("6935721830015"),
      ),
    ).toBe(false);
    expect(
      matchesSkuSearchTerms(
        ["Yizia Wax & Mud", "KK38-721-WBJ", "111222333444"],
        normalizeSkuSearchQuery("111222333444"),
      ),
    ).toBe(true);
  });
});

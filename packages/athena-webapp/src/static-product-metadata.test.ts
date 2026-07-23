import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

function parseIndexHtml() {
  return new DOMParser().parseFromString(indexHtml, "text/html");
}

describe("static product-page metadata", () => {
  it("makes the public proposition visible before JavaScript runs", () => {
    const document = parseIndexHtml();

    expect(document.title).toBe(
      "Athena | Sales and inventory visibility for owner-led retail",
    );
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe(
      "See today's sales, understand what moved, and keep the history behind your business close.",
    );
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe("https://athena.wigclub.store/");
  });

  it("keeps Open Graph metadata aligned with the canonical public page", () => {
    const document = parseIndexHtml();
    const content = (property: string) =>
      document
        .querySelector(`meta[property="${property}"]`)
        ?.getAttribute("content");

    expect(content("og:type")).toBe("website");
    expect(content("og:site_name")).toBe("Athena");
    expect(content("og:title")).toBe(document.title);
    expect(content("og:description")).toBe(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    );
    expect(content("og:url")).toBe("https://athena.wigclub.store/");
  });
});

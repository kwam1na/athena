import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Id } from "../../../_generated/dataModel";
import { collectSessionItemsFromPages } from "./sessionCommandRepository";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("createSessionCommandRepository", () => {
  it("uses the compound session/SKU index for cart-line lookup", () => {
    const source = readProjectFile(
      "convex",
      "pos",
      "infrastructure",
      "repositories",
      "sessionCommandRepository.ts",
    );
    const lookupSource = source.slice(
      source.indexOf("findSessionItemBySku(args)"),
      source.indexOf("getSessionItemById(itemId)"),
    );

    expect(lookupSource).toContain('withIndex("by_sessionId_productSkuId"');
    expect(lookupSource).toContain(".unique()");
    expect(lookupSource).not.toContain(".paginate(");
    expect(lookupSource).not.toContain("findSessionItemBySkuInPages");
  });
});

describe("findSessionItemBySkuInPages", () => {
  it("is no longer the cart-line lookup path", () => {
    const source = readProjectFile(
      "convex",
      "pos",
      "infrastructure",
      "repositories",
      "sessionCommandRepository.ts",
    );

    const lookupSource = source.slice(
      source.indexOf("findSessionItemBySku(args)"),
      source.indexOf("getSessionItemById(itemId)"),
    );

    expect(lookupSource).not.toContain("findSessionItemBySkuInPages");
  });
});

describe("collectSessionItemsFromPages", () => {
  it("returns every item across paginated session results", async () => {
    const items = await collectSessionItemsFromPages(async (cursor) => {
      if (cursor === null) {
        return {
          page: [{ _id: "item-1" }, { _id: "item-2" }],
          isDone: false,
          continueCursor: "page-2",
        };
      }

      return {
        page: [{ _id: "item-3" }],
        isDone: true,
        continueCursor: "done",
      };
    });

    expect(items).toEqual([{ _id: "item-1" }, { _id: "item-2" }, { _id: "item-3" }]);
  });
});

import { describe, expect, it } from "vitest";

import {
  getNextHomepageRank,
  getPresentedHomepageRank,
  sortHomepageRankedItems,
} from "./homepageRanking";

describe("homepage ranking", () => {
  it("sorts ranked rows first and legacy unranked rows last", () => {
    expect(
      sortHomepageRankedItems([
        { _id: "legacy-a" },
        { _id: "ranked-b", rank: 1 },
        { _id: "ranked-a", rank: 0 },
        { _id: "legacy-b" },
      ]).map((item) => item._id),
    ).toEqual(["ranked-a", "ranked-b", "legacy-a", "legacy-b"]);
  });

  it("appends new rows after the highest explicit rank", () => {
    expect(
      getNextHomepageRank([
        { _id: "first", rank: 0 },
        { _id: "legacy" },
        { _id: "last", rank: 4 },
      ]),
    ).toBe(5);
  });

  it("uses collection length when no existing row has an explicit rank", () => {
    expect(getNextHomepageRank([{ _id: "legacy-a" }, { _id: "legacy-b" }])).toBe(
      2,
    );
  });

  it("presents contiguous display ranks after sorting", () => {
    expect(getPresentedHomepageRank({ _id: "ranked", rank: 3 }, 10)).toBe(10);
    expect(getPresentedHomepageRank({ _id: "legacy" }, 10)).toBe(10);
  });
});

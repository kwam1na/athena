import { describe, expect, it } from "vitest";

import {
  decodeSheetReturn,
  encodeSheetReturn,
  sheetReturnFocusSelector,
  sheetReturnTargetProps,
  SHEET_RETURN_ATTRIBUTE,
} from "./sheetReturn";

describe("sheetReturn codec", () => {
  it("round-trips a focus key and a scroll offset", () => {
    const encoded = encodeSheetReturn({ focusKey: "chart:kg2abc", scrollOffset: 640 });

    expect(decodeSheetReturn(encoded)).toEqual({
      focusKey: "chart:kg2abc",
      scrollOffset: 640,
    });
  });

  it("round-trips either half on its own", () => {
    // A sheet that only restores scroll, or only focus, uses the same param.
    expect(decodeSheetReturn(encodeSheetReturn({ scrollOffset: 640 }))).toEqual({
      scrollOffset: 640,
    });
    expect(decodeSheetReturn(encodeSheetReturn({ focusKey: "row-7" }))).toEqual({
      focusKey: "row-7",
    });
  });

  it("survives a key containing separator and URL characters", () => {
    // Keys are each sheet's own vocabulary — colons, slashes and ampersands
    // all show up — so the key is encoded rather than assumed to be safe.
    const focusKey = "table:sku/1&2~3 4";
    const encoded = encodeSheetReturn({ focusKey, scrollOffset: 12 });

    expect(decodeSheetReturn(encoded)).toEqual({ focusKey, scrollOffset: 12 });
  });

  it("emits nothing when there is nothing worth putting in a URL", () => {
    expect(encodeSheetReturn({})).toBeUndefined();
    expect(encodeSheetReturn({ focusKey: "   " })).toBeUndefined();
    // Zero and negative offsets restore nothing, so they are not carried.
    expect(encodeSheetReturn({ scrollOffset: 0 })).toBeUndefined();
    expect(encodeSheetReturn({ scrollOffset: -20 })).toBeUndefined();
    expect(encodeSheetReturn({ scrollOffset: Number.NaN })).toBeUndefined();
  });

  it("rounds a fractional offset rather than carrying sub-pixel noise", () => {
    expect(decodeSheetReturn(encodeSheetReturn({ scrollOffset: 640.4 }))).toEqual(
      { scrollOffset: 640 },
    );
  });

  it("treats anything unparseable as no return token", () => {
    // This comes from a URL. A malformed value must never keep a sheet from
    // opening, so every failure mode degrades to `undefined`.
    expect(decodeSheetReturn(undefined)).toBeUndefined();
    expect(decodeSheetReturn(null)).toBeUndefined();
    expect(decodeSheetReturn(42)).toBeUndefined();
    expect(decodeSheetReturn({})).toBeUndefined();
    expect(decodeSheetReturn("")).toBeUndefined();
    expect(decodeSheetReturn("~")).toBeUndefined();
  });

  it("drops a malformed key instead of throwing", () => {
    // A truncated percent-escape would throw out of decodeURIComponent.
    expect(() => decodeSheetReturn("%E0%A4%A~640")).not.toThrow();
    expect(decodeSheetReturn("%E0%A4%A~640")).toEqual({ scrollOffset: 640 });
  });

  it("ignores an offset that is not a plain non-negative integer", () => {
    // Keeps a hand-edited URL from scrolling somewhere absurd.
    expect(decodeSheetReturn("row-7~abc")).toEqual({ focusKey: "row-7" });
    expect(decodeSheetReturn("row-7~-5")).toEqual({ focusKey: "row-7" });
    expect(decodeSheetReturn("row-7~1.5")).toEqual({ focusKey: "row-7" });
    expect(decodeSheetReturn("row-7~1e9")).toEqual({ focusKey: "row-7" });
    expect(
      decodeSheetReturn(`row-7~${"9".repeat(30)}`),
    ).toEqual({ focusKey: "row-7" });
  });

  it("reads a separator-less value as a focus key", () => {
    // A truncated or hand-written URL still does something sensible.
    expect(decodeSheetReturn("row-7")).toEqual({ focusKey: "row-7" });
  });
});

describe("sheetReturn targets", () => {
  it("escapes a key that would otherwise be read as selector syntax", () => {
    // A key arriving from a URL must not be able to match a different element
    // or throw mid-restore.
    const selector = sheetReturnFocusSelector('evil"] , [data-x="');

    expect(() => document.querySelector(selector)).not.toThrow();
    expect(document.querySelector(selector)).toBeNull();
  });

  it("marks an element under the one shared attribute", () => {
    // Shared, so one sheet cannot return focus to another sheet's target.
    expect(sheetReturnTargetProps("row-7")).toEqual({
      [SHEET_RETURN_ATTRIBUTE]: "row-7",
    });
  });

  it("finds the element it marked", () => {
    const focusKey = "timeline:event:abc 1";
    const element = document.createElement("a");
    for (const [name, value] of Object.entries(
      sheetReturnTargetProps(focusKey),
    )) {
      element.setAttribute(name, value);
    }
    document.body.appendChild(element);

    try {
      expect(document.querySelector(sheetReturnFocusSelector(focusKey))).toBe(
        element,
      );
    } finally {
      element.remove();
    }
  });
});

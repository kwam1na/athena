import { describe, expect, it } from "vitest";

import {
  getNextProcurementModeSearch,
  getNextProcurementPageSearch,
  getNextProcurementQuerySearch,
  getNextProcurementSelectedSkuSearch,
  procurementSearchSchema,
} from "./procurement.index";

describe("procurement route search state", () => {
  it("encodes the selected SKU in the URL search state", () => {
    expect(
      getNextProcurementSelectedSkuSearch(
        { procurementMode: "planned", vendor: "vendor-1" },
        "6N2Y-XEH-P6B",
        2,
      ),
    ).toEqual({
      page: 2,
      procurementMode: "planned",
      sku: "6N2Y-XEH-P6B",
      vendor: "vendor-1",
    });
  });

  it("clears only the selected SKU from the URL search state", () => {
    expect(
      getNextProcurementSelectedSkuSearch(
        { procurementMode: "planned", sku: "6N2Y-XEH-P6B" },
        null,
      ),
    ).toEqual({ procurementMode: "planned" });
  });

  it("keeps needs-action mode implicit without clearing the selected SKU", () => {
    expect(
      getNextProcurementModeSearch(
        { page: 3, procurementMode: "planned", sku: "6N2Y-XEH-P6B" },
        "needs_action",
      ),
    ).toEqual({ page: 1, sku: "6N2Y-XEH-P6B" });
  });

  it("normalizes the removed handled mode to the default queue", () => {
    expect(
      procurementSearchSchema.parse({
        page: "2",
        procurementMode: "resolved",
        query: "cw",
      }),
    ).toEqual({ page: 2, procurementMode: undefined, query: "cw" });
  });

  it("encodes SKU search query state and clears the selected SKU", () => {
    expect(
      getNextProcurementQuerySearch(
        {
          page: 3,
          procurementMode: "planned",
          query: "old",
          sku: "6N2Y-XEH-P6B",
        },
        "CW",
      ),
    ).toEqual({ page: 1, procurementMode: "planned", query: "CW" });
  });

  it("clears empty procurement SKU search state", () => {
    expect(
      getNextProcurementQuerySearch(
        { page: 3, procurementMode: "planned", query: "CW", sku: "CW-18" },
        undefined,
      ),
    ).toEqual({ page: 1, procurementMode: "planned" });
  });

  it("encodes the visible recommendation page in the URL search state", () => {
    expect(
      getNextProcurementPageSearch(
        { procurementMode: "planned", sku: "6N2Y-XEH-P6B" },
        4,
      ),
    ).toEqual({
      page: 4,
      procurementMode: "planned",
      sku: "6N2Y-XEH-P6B",
    });
  });
});

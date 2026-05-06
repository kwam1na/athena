import { describe, expect, it } from "vitest";

import {
  getNextProcurementModeSearch,
  getNextProcurementPageSearch,
  getNextProcurementSelectedSkuSearch,
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

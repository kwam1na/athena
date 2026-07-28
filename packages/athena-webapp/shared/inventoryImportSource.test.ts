import { describe, expect, it } from "vitest";

import {
  interpretInventoryImportCost,
  projectInventoryImportSource,
} from "./inventoryImportSource";

describe("inventory import source projection", () => {
  it("preserves stable CSV column identities, duplicate ordinals, samples, and raw cells", () => {
    const projection = projectInventoryImportSource({
      fileName: "legacy.csv",
      content: [
        " Product Name ,Cost,Cost,Notes",
        '" Closure ",10.50,11.00," raw note "',
        "Frontal,20.00,21.00,second",
      ].join("\n"),
    });

    expect(projection.errors).toEqual([]);
    expect(projection.columns).toEqual([
      {
        costValidity: { invalid: 2, valid: 0 },
        id: "csv:product_name:1",
        label: " Product Name ",
        normalizedKey: "product_name",
        ordinal: 1,
        sourcePath: "$[0]",
        sampleValues: [" Closure ", "Frontal"],
      },
      {
        costValidity: { invalid: 0, valid: 2 },
        id: "csv:cost:1",
        label: "Cost",
        normalizedKey: "cost",
        ordinal: 1,
        sourcePath: "$[1]",
        sampleValues: ["10.50", "20.00"],
      },
      {
        costValidity: { invalid: 0, valid: 2 },
        id: "csv:cost:2",
        label: "Cost",
        normalizedKey: "cost",
        ordinal: 2,
        sourcePath: "$[2]",
        sampleValues: ["11.00", "21.00"],
      },
      {
        costValidity: { invalid: 2, valid: 0 },
        id: "csv:notes:1",
        label: "Notes",
        normalizedKey: "notes",
        ordinal: 1,
        sourcePath: "$[3]",
        sampleValues: [" raw note ", "second"],
      },
    ]);
    expect(projection.rows[0]).toEqual({
      id: "csv:$[1]",
      rowNumber: 2,
      sourcePath: "$[1]",
      cells: [
        { columnId: "csv:product_name:1", rawValue: " Closure " },
        { columnId: "csv:cost:1", rawValue: "10.50" },
        { columnId: "csv:cost:2", rawValue: "11.00" },
        { columnId: "csv:notes:1", rawValue: " raw note " },
      ],
    });
  });

  it("preserves stable nested JSON paths and source-row identity", () => {
    const projection = projectInventoryImportSource({
      fileName: "legacy.json",
      content: JSON.stringify({
        products: [
          {
            name: "Closure",
            category: "Hair",
            variants: [
              { sku: "C-12", landed_cost: "12.50" },
              { sku: "C-14", landed_cost: null },
            ],
          },
        ],
      }),
    });

    expect(projection.errors).toEqual([]);
    expect(projection.columns).toEqual([
      {
        costValidity: { invalid: 2, valid: 0 },
        id: "json:$.products[].name",
        label: "name",
        normalizedKey: "name",
        ordinal: 1,
        sourcePath: "$.products[].name",
        sampleValues: ["Closure", "Closure"],
      },
      {
        costValidity: { invalid: 2, valid: 0 },
        id: "json:$.products[].category",
        label: "category",
        normalizedKey: "category",
        ordinal: 1,
        sourcePath: "$.products[].category",
        sampleValues: ["Hair", "Hair"],
      },
      {
        costValidity: { invalid: 2, valid: 0 },
        id: "json:$.products[].variants[].sku",
        label: "sku",
        normalizedKey: "sku",
        ordinal: 1,
        sourcePath: "$.products[].variants[].sku",
        sampleValues: ["C-12", "C-14"],
      },
      {
        costValidity: { invalid: 1, valid: 1 },
        id: "json:$.products[].variants[].landed_cost",
        label: "landed_cost",
        normalizedKey: "landed_cost",
        ordinal: 1,
        sourcePath: "$.products[].variants[].landed_cost",
        sampleValues: ["12.50"],
      },
    ]);
    expect(
      projection.rows.map(({ id, sourcePath }) => ({ id, sourcePath })),
    ).toEqual([
      {
        id: "json:$.products[0].variants[0]",
        sourcePath: "$.products[0].variants[0]",
      },
      {
        id: "json:$.products[0].variants[1]",
        sourcePath: "$.products[0].variants[1]",
      },
    ]);
    expect(projection.rows[1].cells.at(-1)).toEqual({
      columnId: "json:$.products[].variants[].landed_cost",
      rawValue: null,
    });
  });
});

describe("inventory import cost interpretation", () => {
  it.each([undefined, null, "", "   "])(
    "classifies %p as missing",
    (rawValue) => {
      expect(
        interpretInventoryImportCost(rawValue, { currencyScale: 2 }),
      ).toEqual({
        kind: "missing",
      });
    },
  );

  it.each([
    ["0", 0],
    [0, 0],
    ["12", 1200],
    ["GHS 1,234.50", 123450],
    ["¢ 0.05", 5],
  ])(
    "converts valid major-unit value %p to %i minor units",
    (rawValue, minorUnits) => {
      expect(
        interpretInventoryImportCost(rawValue, { currencyScale: 2 }),
      ).toEqual({
        kind: "valid",
        minorUnits,
      });
    },
  );

  it.each([
    ["not money", "invalid"],
    ["12oops34", "invalid"],
    ["-1.00", "negative"],
    ["(1.00)", "negative"],
    ["1.234", "excess_precision"],
    ["90071992547409.92", "out_of_range"],
  ] as const)("classifies %p as %s", (rawValue, kind) => {
    expect(
      interpretInventoryImportCost(rawValue, { currencyScale: 2 }),
    ).toEqual({ kind });
  });
});

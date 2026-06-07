import { describe, expect, it } from "vitest";

import { parseInventoryImportContent } from "./inventoryImportParser";

describe("inventory import parser", () => {
  it("parses quoted CSV rows into Athena inventory rows", () => {
    const result = parseInventoryImportContent({
      fileName: "legacy.csv",
      content: [
        "product_name,category,subcategory,sku,barcode,price,cost,qty,color,size,status",
        '"Body Wave, Premium",Hair,Wigs,BW-18,123456789012,450.50,300,7,Natural,18,active',
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        productName: "Body Wave, Premium",
        category: "Hair",
        subcategory: "Wigs",
        sku: "BW-18",
        barcode: "123456789012",
        price: 45050,
        unitCost: 30000,
        quantity: 7,
        color: "Natural",
        size: "18",
        status: "active",
      },
    ]);
  });

  it("parses JSON product objects with nested skus", () => {
    const result = parseInventoryImportContent({
      fileName: "legacy.json",
      content: JSON.stringify({
        products: [
          {
            name: "Closure",
            category: "Hair",
            variants: [
              {
                sku: "CLOSURE-12",
                barcode: "99887766",
                selling_price: "120",
                stock_quantity: 3,
                colour: "Black",
              },
            ],
          },
        ],
      }),
    });

    expect(result.errors).toEqual([]);
    expect(result.rows).toMatchObject([
      {
        productName: "Closure",
        category: "Hair",
        sku: "CLOSURE-12",
        barcode: "99887766",
        price: 12000,
        quantity: 3,
        color: "Black",
      },
    ]);
  });

  it("keeps duplicate and incomplete legacy rows importable", () => {
    const result = parseInventoryImportContent({
      fileName: "legacy.csv",
      content: [
        "name,sku,barcode,price,stock",
        "Known wig,SKU-1,,100,2",
        "Duplicate wig,SKU-1,,120,4",
        "Missing price,SKU-2,,,-1",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1]).toMatchObject({
      rowNumber: 3,
      productName: "Duplicate wig",
      sku: "SKU-1",
    });
    expect(result.rows[2]).toMatchObject({
      rowNumber: 4,
      productName: "Missing price",
      price: 0,
      quantity: 0,
    });
  });

  it("maps legacy POS exports with alternate headers without blocking preview", () => {
    const result = parseInventoryImportContent({
      fileName: "products.csv",
      content: [
        "product_id,cid,code,pname,o_price,price,profit,onhand_qty,qty,supplier,qty_sold,description",
        '7,,GUBS CINCONA EARRINGS,,30,35,5,12,,,"0",""',
        '8,,ROYAL COLD SET CHAIN,,125,150,25,,4,,"0",""',
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(result.rows).toMatchObject([
      {
        rowNumber: 2,
        productName: "GUBS CINCONA EARRINGS",
        sku: "GUBS CINCONA EARRINGS",
        price: 3500,
        unitCost: 3000,
        quantity: 12,
      },
      {
        rowNumber: 3,
        productName: "ROYAL COLD SET CHAIN",
        sku: "ROYAL COLD SET CHAIN",
        price: 15000,
        unitCost: 12500,
        quantity: 4,
      },
    ]);
  });

  it("keeps sparse legacy rows importable with fallback Athena fields", () => {
    const result = parseInventoryImportContent({
      fileName: "legacy.csv",
      content: [
        "legacy_id,department,notes",
        "42,Accessories,walk-in import row",
      ].join("\n"),
    });

    expect(result.errors).toEqual([]);
    expect(result.rows).toMatchObject([
      {
        rowNumber: 2,
        productName: "walk-in import row",
        category: "Accessories",
        sku: "42",
        price: 0,
        quantity: 0,
      },
    ]);
  });
});

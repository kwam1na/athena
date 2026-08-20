import type { DailyManagerReportRankedRow } from "../emails/DailyManagerReport";
import { formatProductDisplayName } from "../../shared/productDisplayName";

export type ManagerReportExpenseProduct = {
  productName: string;
  productSku: string;
  productSkuId: unknown;
  quantity: number;
  spendMinor: number;
};

export type ManagerReportExpenseRemainder = {
  productCount: number;
  quantity: number;
  spendMinor: number;
};

type RankedExpenseProducts = {
  byQuantity: ManagerReportExpenseProduct[];
  bySpend: ManagerReportExpenseProduct[];
  quantityRemainder: ManagerReportExpenseRemainder | null;
  spendRemainder: ManagerReportExpenseRemainder | null;
};

export function rankManagerReportExpenseProducts(
  products: ManagerReportExpenseProduct[],
): RankedExpenseProducts {
  const bySpend = [...products]
    .sort(
      (left, right) =>
        right.spendMinor - left.spendMinor ||
        right.quantity - left.quantity ||
        String(left.productSkuId).localeCompare(String(right.productSkuId)),
    )
    .slice(0, 5);
  const byQuantity = [...products]
    .sort(
      (left, right) =>
        right.quantity - left.quantity ||
        right.spendMinor - left.spendMinor ||
        String(left.productSkuId).localeCompare(String(right.productSkuId)),
    )
    .slice(0, 5);

  return {
    byQuantity,
    bySpend,
    quantityRemainder: expenseRemainder(products, byQuantity),
    spendRemainder: expenseRemainder(products, bySpend),
  };
}

export function buildManagerReportExpenseSections(
  expenses: RankedExpenseProducts,
  money: (minor: number) => string,
  coverage?: string,
) {
  const row = (
    product: ManagerReportExpenseProduct,
    rankBy: "spend" | "quantity",
  ): DailyManagerReportRankedRow => ({
    label: formatProductDisplayName(product.productName),
    detail: product.productSku,
    primary:
      rankBy === "spend"
        ? money(product.spendMinor)
        : formatUnits(product.quantity),
    secondary:
      rankBy === "spend"
        ? formatUnits(product.quantity)
        : money(product.spendMinor),
  });
  const remainder = (
    value: ManagerReportExpenseRemainder | null,
    rankBy: "spend" | "quantity",
  ): DailyManagerReportRankedRow | undefined =>
    value
      ? {
          label: `${value.productCount.toLocaleString("en-US")} other ${value.productCount === 1 ? "product" : "products"}`,
          primary:
            rankBy === "spend"
              ? money(value.spendMinor)
              : formatUnits(value.quantity),
          secondary:
            rankBy === "spend"
              ? formatUnits(value.quantity)
              : money(value.spendMinor),
        }
      : undefined;

  return [
    {
      coverage,
      remainder: remainder(expenses.spendRemainder, "spend"),
      rows: expenses.bySpend.map((product) => row(product, "spend")),
      title: "Top expense products by spend",
    },
    {
      coverage,
      remainder: remainder(expenses.quantityRemainder, "quantity"),
      rows: expenses.byQuantity.map((product) => row(product, "quantity")),
      title: "Top expense products by quantity",
    },
  ];
}

function expenseRemainder(
  allRows: ManagerReportExpenseProduct[],
  rankedRows: ManagerReportExpenseProduct[],
): ManagerReportExpenseRemainder | null {
  if (allRows.length === rankedRows.length) return null;
  const rankedIds = new Set(rankedRows.map((row) => String(row.productSkuId)));
  const omitted = allRows.filter(
    (row) => !rankedIds.has(String(row.productSkuId)),
  );
  return {
    productCount: omitted.length,
    quantity: omitted.reduce((sum, row) => sum + row.quantity, 0),
    spendMinor: omitted.reduce((sum, row) => sum + row.spendMinor, 0),
  };
}

function formatUnits(quantity: number): string {
  return `${quantity.toLocaleString("en-US")} ${quantity === 1 ? "unit" : "units"}`;
}

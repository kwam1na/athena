import type { ReportSkuMixData } from "../../shared/reportsContract";
import type { DailyManagerReportTopItem } from "../emails/DailyManagerReport";

/** Project the canonical Reports SKU-mix contract into the compact email row. */
export function managerReportTopItemsFromMix(
  mix: ReportSkuMixData,
): DailyManagerReportTopItem[] {
  return mix.rows
    .filter(
      (row): row is typeof row & { productSkuId: string } =>
        row.productSkuId !== undefined,
    )
    .slice(0, 5)
    .map((row) => {
      const name =
        row.identity?.displayName ?? row.identity?.sku ?? row.label;
      const detail = [row.identity?.sku, row.identity?.size]
        .filter((value) => value && value !== name)
        .join(" · ");

      return {
        name,
        unitsSold: row.unitsSold,
        ...(detail ? { detail } : {}),
      };
    });
}

import type { FunctionReturnType } from "convex/server";
import { Link } from "@tanstack/react-router";

import { ListPagination } from "@/components/common/ListPagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getOrigin } from "@/lib/navigationUtils";
import { api } from "~/convex/_generated/api";
import { REPORT_SKU_PAGE_SIZE } from "~/shared/reportsContract";
import type { ReportPeriodType } from "./reportPeriodKeys";
import {
  formatOptionalMoney,
  formatReportProfit,
  formatSkuDisplayName,
  formatSkuSubtitle,
  formatUnits,
} from "./reportFormat";

type Result = FunctionReturnType<typeof api.reports.queries.listPeriodSkus>;

export function ReportsItemsTable({
  rows,
  currency,
  periodDate,
  periodType,
  orgUrlSlug,
  storeUrlSlug,
  cursor,
  continueCursor,
  currentPage,
  isRefreshing,
  onPageChange,
}: {
  rows: Result["rows"];
  currency: string;
  periodDate: string;
  periodType: ReportPeriodType;
  orgUrlSlug: string;
  storeUrlSlug: string;
  cursor?: string;
  continueCursor: string | null;
  currentPage: number;
  isRefreshing: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <section
      aria-label="Item sales results"
      aria-busy={isRefreshing}
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-surface-raised shadow-surface",
        "transition-opacity duration-150 motion-reduce:transition-none",
        isRefreshing && "opacity-60",
      )}
      data-refreshing={isRefreshing ? "true" : undefined}
      data-testid="items-results-table"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Net sales</TableHead>
            <TableHead>Units sold</TableHead>
            <TableHead>Gross profit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.productSkuId}>
              <TableCell>
                <Link
                  className="block min-w-0"
                  params={{ orgUrlSlug, storeUrlSlug, productSkuId: row.productSkuId }}
                  search={{ o: getOrigin(), periodDate, periodType }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId"
                >
                  <span className="block truncate font-medium text-foreground">
                    {formatSkuDisplayName(row.identity, row.productSkuId)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatSkuSubtitle(row.identity, row.productSkuId)}
                  </span>
                </Link>
              </TableCell>
              <TableCell>{formatOptionalMoney(row.netSalesMinor, currency)}</TableCell>
              <TableCell>{formatUnits(row.unitsSold)}</TableCell>
              <TableCell>{formatReportProfit(row.grossProfitMinor, currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {cursor || continueCursor ? (
        <ListPagination
          currentItems={rows.length}
          hasNextPage={continueCursor !== null}
          mode="cursor"
          onPageChange={onPageChange}
          page={currentPage}
          pageSize={REPORT_SKU_PAGE_SIZE}
        />
      ) : null}
    </section>
  );
}

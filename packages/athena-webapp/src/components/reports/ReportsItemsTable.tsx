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
import {
  REPORT_SKU_PAGE_SIZE,
  type ReportSkuPeriodRow,
} from "~/shared/reportsContract";
import type { ReportPeriodType } from "./reportPeriodKeys";
import {
  formatOptionalMoney,
  formatReportProfit,
  formatSkuDisplayName,
  formatSkuSubtitle,
  formatUnits,
} from "./reportFormat";

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
  rows: ReportSkuPeriodRow[];
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
                  params={{
                    orgUrlSlug,
                    storeUrlSlug,
                    productSkuId: row.productSkuId,
                  }}
                  search={{ o: getOrigin(), periodDate, periodType }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId"
                >
                  <span className="block truncate font-medium text-foreground">
                    {formatSkuDisplayName(row.identity, row.productSkuId)}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs leading-5 text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {formatSkuSubtitle(row.identity, row.productSkuId)}
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground/60"
                    >
                      ·
                    </span>
                    <span
                      aria-label={`Net price ${formatOptionalMoney(
                        row.identity?.netPriceMinor,
                        currency,
                      )}`}
                      className="whitespace-nowrap font-numeric tabular-nums text-foreground"
                    >
                      {formatOptionalMoney(
                        row.identity?.netPriceMinor,
                        currency,
                      )}
                    </span>
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                {formatOptionalMoney(row.netSalesMinor, currency)}
              </TableCell>
              <TableCell>{formatUnits(row.unitsSold)}</TableCell>
              <TableCell>
                {formatReportProfit(row.grossProfitMinor, currency)}
              </TableCell>
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

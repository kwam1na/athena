import { formatStoredCurrencyAmount } from "@/lib/pos/displayAmounts";
import { currencyFormatter } from "@/lib/utils";
import {
  REPORT_DAY_STATUSES,
  type ReportDayStatus,
} from "~/shared/reportsContract";

/**
 * Formats a minor-unit money amount using the repo's existing currency
 * formatting helper (`formatStoredCurrencyAmount`) — the same helper used by
 * POS and operations views. Reports always want cents/pesewas precision, so
 * minor units are always revealed.
 */
export function formatReportMoney(amountMinor: number, currency: string) {
  return formatStoredCurrencyAmount(currency, amountMinor, {
    revealMinorUnits: true,
  });
}

/** Explicit copy for the honest-uncosted-profit case — never a bare dash. */
export const PROFIT_UNAVAILABLE_LABEL = "profit unavailable (uncosted)";

/**
 * Renders a gross-profit-shaped metric. `null` means "no cost basis was
 * available for any of the revenue in this period" (per the contract's
 * `grossProfitMinor` semantics) — that must never collapse to the same
 * treatment as "no data yet" ("—" for a missing/absent value).
 */
export function formatReportProfit(
  grossProfitMinor: number | null,
  currency: string,
): string {
  if (grossProfitMinor === null) return PROFIT_UNAVAILABLE_LABEL;
  return formatReportMoney(grossProfitMinor, currency);
}

/** "—" is reserved for values that are genuinely null — never a missing key. */
export function formatOptionalMoney(
  amountMinor: number | null | undefined,
  currency: string,
): string {
  if (amountMinor === null || amountMinor === undefined) return "—";
  return formatReportMoney(amountMinor, currency);
}

export function formatUnits(units: number | null | undefined): string {
  if (units === null || units === undefined) return "—";
  return units.toLocaleString();
}

/**
 * Compact money for chart axis ticks (e.g. "$12k", "$1.2m") — wraps the
 * repo's own currency formatter, same as `formatReportMoney`, just with a
 * k/m suffix instead of full precision.
 */
export function formatCompactReportMoney(
  amountMinor: number,
  currency: string,
): string {
  const majorAmount = amountMinor / 100;
  const absMajor = Math.abs(majorAmount);

  if (absMajor >= 1_000_000) {
    const formatter = currencyFormatter(currency, { maximumFractionDigits: 1 });
    return `${formatter.format(majorAmount / 1_000_000)}m`;
  }

  if (absMajor >= 1_000) {
    const formatter = currencyFormatter(currency, { maximumFractionDigits: 1 });
    return `${formatter.format(majorAmount / 1_000)}k`;
  }

  const formatter = currencyFormatter(currency, { maximumFractionDigits: 0 });
  return formatter.format(majorAmount);
}

/** Basis-point comparison (e.g. `netSalesVsPriorWeekBp`). Null renders "—". */
export function formatBasisPoints(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return "—";
  const percent = bp / 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(1)}%`;
}

export type ReportStatusTone = "neutral" | "notice" | "warning" | "positive";

const DAY_STATUS_PRESENTATION: Record<
  ReportDayStatus,
  { label: string; tone: ReportStatusTone }
> = {
  open: { label: "Open", tone: "neutral" },
  provisional: { label: "Provisional", tone: "notice" },
  reconciled: { label: "Reconciled", tone: "positive" },
  amended: { label: "Amended", tone: "warning" },
};

export function reportDayStatusPresentation(status: ReportDayStatus) {
  return DAY_STATUS_PRESENTATION[status];
}

// Compile-time guard: every contract status has a presentation entry.
export const _reportDayStatusesCovered = REPORT_DAY_STATUSES.every(
  (status) => DAY_STATUS_PRESENTATION[status] !== undefined,
);

export function formatOperatingDate(operatingDate: string): string {
  const date = new Date(`${operatingDate}T00:00:00.000Z`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

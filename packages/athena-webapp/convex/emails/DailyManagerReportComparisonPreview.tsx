import { currencyFormatter } from "../utils";
import DailyManagerReport from "./DailyManagerReport";

const money = currencyFormatter("GHS");

export default function DailyManagerReportComparisonPreview() {
  return (
    <DailyManagerReport
      blockers={[]}
      carryForwardItems={[]}
      cashMetrics={[
        {
          comparison: "8% higher vs prior day",
          label: "Expected cash",
          value: money.format(14_154),
        },
        {
          comparison: "8% higher vs prior day",
          label: "Counted cash",
          value: money.format(14_154),
        },
        {
          comparison: "64% lower vs prior day",
          label: "Net variance",
          value: money.format(101),
        },
      ]}
      completedAt="8:42 PM"
      completedBy="Athena"
      frameVariant="unbordered"
      operatingDate="Friday, July 17"
      paymentTotals={[
        {
          amount: money.format(14_154),
          amountComparison: "8% higher vs prior day",
          method: "Cash",
          transactionCount: 3,
          transactionCountComparison: "25% lower vs prior day",
        },
        {
          amount: money.format(3_540),
          amountComparison: "42% higher vs prior day",
          method: "Card",
          transactionCount: 1,
          transactionCountComparison: "In line with prior day",
        },
        {
          amount: money.format(2_500),
          amountComparison: "17% lower vs prior day",
          method: "Mobile money",
          transactionCount: 1,
          transactionCountComparison: "50% lower vs prior day",
        },
      ]}
      reportUrl="https://athena.wigclub.store/wigclub/store/wigclub/operations/daily-close?operatingDate=2026-07-17"
      reviewedItems={[]}
      status="applied"
      storeCurrency="GHS"
      storeName="Wigclub"
      summaryMetrics={[
        {
          comparison: "67% lower vs prior day",
          detail: "4 transactions",
          detailComparison: "89% lower vs prior day",
          label: "Sales",
          value: money.format(20_194),
        },
        {
          comparison: "22% lower vs prior day",
          detail: "2 reports",
          detailComparison: "In line with prior day",
          label: "Expenses",
          value: money.format(540),
        },
        {
          comparison: "50% lower vs prior day",
          label: "Voids",
          value: "1",
        },
      ]}
    />
  );
}

import { currencyFormatter } from "../utils";
import DailyManagerReport, {
  dailyManagerReportPreviewProps,
} from "./DailyManagerReport";

const money = currencyFormatter("GHS");

export default function DailyManagerReportComparisonPreview() {
  return (
    <DailyManagerReport
      {...dailyManagerReportPreviewProps}
      blockers={[]}
      carryForwardItems={[]}
      cashMetrics={[
        {
          comparison: "64% lower vs prior day",
          label: "Expected cash",
          value: money.format(615),
        },
        {
          comparison: "66% lower vs prior day",
          label: "Counted cash",
          value: money.format(573),
        },
        {
          comparison: "In line with prior day",
          label: "Net variance",
          value: money.format(-42),
        },
      ]}
      completedAt="8:47 PM"
      completedBy="Athena"
      frameVariant="unbordered"
      operatingDate="Saturday, Aug 8"
      paymentTotals={[
        {
          amount: money.format(615),
          amountComparison: "61% lower vs prior day",
          method: "Cash",
          transactionCount: 2,
          transactionCountComparison: "67% lower vs prior day",
        },
        {
          amount: money.format(820),
          amountComparison: "68% lower vs prior day",
          method: "Card",
          transactionCount: 2,
          transactionCountComparison: "80% lower vs prior day",
        },
        {
          amount: money.format(500),
          amountComparison: "61% lower vs prior day",
          method: "Mobile money",
          transactionCount: 1,
          transactionCountComparison: "67% lower vs prior day",
        },
      ]}
      reportUrl="https://athena-os.app/wigclub/store/wigclub/operations/daily-close?operatingDate=2026-08-08"
      reviewedItems={[]}
      status="applied"
      storeCurrency="GHS"
      storeName="Wigclub"
      summaryMetrics={[
        {
          comparison: "64% lower vs prior day",
          label: "Net sales",
          value: money.format(1935),
        },
        {
          comparison: "74% lower vs prior day",
          label: "Transactions",
          value: "5",
        },
        {
          comparison: "70% lower vs prior day",
          label: "Units sold",
          value: "23",
        },
      ]}
    />
  );
}

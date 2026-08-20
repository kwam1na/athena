import DailyManagerReport, {
  type DailyManagerReportProps,
} from "./DailyManagerReport";

const noPriorActivity = "No activity on prior day";

/**
 * Frozen from the production Wigclub payload for the 2026-08-17 close.
 * Internal document identifiers are intentionally excluded.
 */
export const dailyManagerReportProductionPreviewProps = {
  blockers: [],
  carryForwardItems: Array.from({ length: 65 }, (_, index) => ({
    message: "65 carry-forward items",
    title: index === 0 ? "Opening handoff" : `Carry-forward ${index + 1}`,
    tone: "warning" as const,
  })),
  cashMetrics: [
    {
      comparison: noPriorActivity,
      detail: "Includes GH₵1 opening float",
      label: "Expected cash",
      value: "GH₵496",
    },
    {
      comparison: noPriorActivity,
      label: "Counted cash",
      value: "GH₵615",
    },
    {
      comparison: noPriorActivity,
      label: "Net variance",
      value: "GH₵119",
    },
  ],
  completedAt: "10:00 PM",
  completedBy: "Athena",
  frameVariant: "unbordered",
  operatingDate: "Monday, August 17",
  paymentTotals: [
    {
      amount: "GH₵2,685",
      amountComparison: noPriorActivity,
      method: "Mobile Money",
      transactionCount: 12,
      transactionCountComparison: noPriorActivity,
    },
    {
      amount: "GH₵4,830",
      amountComparison: noPriorActivity,
      method: "Card",
      transactionCount: 2,
      transactionCountComparison: noPriorActivity,
    },
    {
      amount: "GH₵495",
      amountComparison: noPriorActivity,
      method: "Cash",
      transactionCount: 4,
      transactionCountComparison: noPriorActivity,
    },
  ],
  presentation: {
    rankedSectionPlacement: "before-cash",
    rankedSectionTitle: "Expenses",
  },
  rankedSectionSummary: {
    comparison: noPriorActivity,
    detail: "No reports",
    detailComparison: noPriorActivity,
    label: "Total expenses",
    value: "GH₵0",
  },
  reportUrl:
    "https://athena-os.app/wigclub/store/wigclub/operations/daily-close?operatingDate=2026-08-17",
  reviewedItems: [
    {
      message: "1 register variance reviewed.",
      meta: "Reviewed during close",
      metrics: [
        {
          comparison: noPriorActivity,
          label: "Expected",
          value: "GH₵496",
        },
        {
          comparison: noPriorActivity,
          label: "Counted",
          value: "GH₵615",
        },
        {
          comparison: noPriorActivity,
          label: "Over",
          value: "GH₵119",
        },
      ],
      title: "Cash variance",
      tone: "warning",
    },
  ],
  status: "applied",
  storeCurrency: "GHS",
  storeName: "Wigclub",
  summaryMetrics: [
    {
      comparison: noPriorActivity,
      label: "Sales",
      value: "GH₵8,010",
    },
    {
      comparison: noPriorActivity,
      label: "Transactions",
      value: "18",
    },
    {
      comparison: noPriorActivity,
      label: "Units sold",
      value: "57",
    },
  ],
  topItems: [
    {
      detail: "KK38-MJG-ZVQ",
      name: "DEEPWAVE FAETHER 24",
      unitsSold: 4,
    },
    {
      detail: "KK38-E2Z-E9V",
      name: "promaxgold 3000w hair dryer",
      unitsSold: 3,
    },
    {
      detail: "KK38-DGB-W6V",
      name: "Nab lace tint mousse 120ml",
      unitsSold: 3,
    },
    {
      detail: "KK38-7S2-PDB",
      name: "tweezers",
      unitsSold: 2,
    },
    {
      detail: "KK38-F8F-3XY",
      name: "Got2b glued blasting freeze hairspray 300ml",
      unitsSold: 2,
    },
  ],
  topItemsUrl:
    "https://athena-os.app/wigclub/store/wigclub/reports?daysStart=2026-08-17&daysEnd=2026-08-17&daysTableStart=2026-08-17&daysTableEnd=2026-08-17&selectedDay=2026-08-17&units=true",
} satisfies DailyManagerReportProps;

export default function DailyManagerReportUnbordered() {
  return <DailyManagerReport {...dailyManagerReportProductionPreviewProps} />;
}

import DailyManagerReport, {
  type DailyManagerReportProps,
} from "./DailyManagerReport";

export const weeklyManagerReportPreviewProps = {
  attentionItems: [],
  cashMetrics: [
    { label: "Units sold", value: "281" },
    { label: "Units returned", value: "4" },
    {
      label: "Net units",
      value: "277",
      detail: "18 more units than prior week",
    },
  ],
  completedAt: "8:47 PM",
  completedBy: "Athena",
  notes:
    "Merchandise margin unavailable because some sold items do not have a recorded cost.",
  operatingDate: "Aug 3–8, 2026",
  paymentTotals: [
    {
      method: "Mobile money",
      amount: "GH₵16,580",
      share: "66.25%",
      tenderUseCount: 63,
    },
    {
      method: "Cash",
      amount: "GH₵5,020",
      share: "20.06%",
      tenderUseCount: 26,
    },
    {
      method: "Card",
      amount: "GH₵3,425",
      share: "13.69%",
      tenderUseCount: 10,
    },
  ],
  presentation: {
    actionLabel: "View weekly report",
    cashSectionTitle: "Item movement",
    emptyAttentionCopy:
      "Net sales finished GH₵3,120 above the prior week. All scheduled days closed, and payments were fully accounted for. Review the close variance and inventory follow-up below.",
    eyebrow: "Athena weekly report",
    handoffSectionTitle: "Executive summary",
    notesLabel: "Reporting note",
    paymentSectionPlacement: "after-summary",
    paymentSectionTitle: "Payment mix",
    previewText:
      "Wigclub weekly report accepted · GH₵27,455 net sales · Aug 3–8, 2026",
    summarySectionTitle: "Weekly performance",
    summaryMetricLayout: "lead",
    topItemsPlacement: "after-cash",
    timestampLabel: "Accepted",
    timestampDate: "Aug 8",
  },
  reportUrl:
    "https://athena.wigclub.store/wigclub/store/wigclub/reports/weekly?reportId=week%3A2026-08-03",
  reportSections: [
    {
      title: "Close variance",
      message: "Net close variance was GH₵42 short.",
    },
    {
      title: "Counted cash variance",
      message: "Counted cash was GH₵320 over.",
    },
    {
      title: "Inventory attention",
      message: "2 new review groups · 1 carried forward",
      meta: "Review before the next operating week begins.",
    },
  ],
  rankedSections: [
    {
      remainder: {
        label: "6 other products",
        primary: "GH₵305",
        secondary: "8 units",
      },
      rows: [
        {
          detail: "LR-02",
          label: "Lace remover",
          primary: "GH₵200",
          secondary: "2 units",
        },
      ],
      title: "Top expense products by spend",
    },
    {
      remainder: {
        label: "6 other products",
        primary: "8 units",
        secondary: "GH₵305",
      },
      rows: [
        {
          detail: "GEL-01",
          label: "Styling gel",
          primary: "5 units",
          secondary: "GH₵120",
        },
      ],
      title: "Top expense products by quantity",
    },
  ],
  status: "applied",
  statusLabel: "Week complete",
  statusSummary:
    "All scheduled days are closed. This weekly report is ready to review.",
  storeCurrency: "GHS",
  storeName: "Wigclub",
  summaryMetrics: [
    {
      label: "Net sales",
      value: "GH₵27,455",
      detail: "GH₵3,120 higher than prior week",
    },
    { label: "Gross sales", value: "GH₵28,040" },
    { label: "Refunds", value: "GH₵585" },
    {
      label: "Transactions",
      value: "78",
      detail: "Completed POS transactions",
    },
  ],
  topItems: [
    { name: "Silk Press 18\"", detail: "SP18-NAT", unitsSold: 38 },
    { name: "Body Wave 20\"", detail: "BW20-1B", unitsSold: 31 },
    { name: "HD Lace Closure", detail: "HDLC-14", unitsSold: 24 },
  ],
  topItemsUrl:
    "https://athena.wigclub.store/wigclub/store/wigclub/reports/weekly?reportId=week%3A2026-08-03&units=true",
} satisfies DailyManagerReportProps;

export function WeeklyManagerReport(props: DailyManagerReportProps) {
  return <DailyManagerReport {...props} />;
}

export default function WeeklyManagerReportPreview() {
  return <WeeklyManagerReport {...weeklyManagerReportPreviewProps} />;
}

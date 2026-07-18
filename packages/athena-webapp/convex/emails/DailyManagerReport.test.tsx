import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import DailyManagerReport, {
  dailyManagerReportPreviewProps,
  type DailyManagerReportProps,
} from "./DailyManagerReport";
import { currencyFormatter } from "../utils";

const ghs = currencyFormatter("GHS");

const baseProps: DailyManagerReportProps = {
  storeName: "Wigclub",
  operatingDate: "Friday, July 3",
  completedAt: "8:42 PM",
  completedBy: "Athena",
  storeCurrency: "GHS",
  status: "applied",
  reportUrl: "https://athena.wigclub.store/wigclub/store/wigclub/operations",
  reviewedItems: [],
  carryForwardItems: [],
  blockers: [],
  summaryMetrics: [
    { label: "Sales", value: ghs.format(12430), detail: "84 transactions" },
    { label: "Expenses", value: ghs.format(340), detail: "1 report" },
  ],
  cashMetrics: [
    { label: "Expected cash", value: ghs.format(1201.82) },
    { label: "Counted cash", value: ghs.format(1201.82) },
    { label: "Net variance", value: ghs.format(0) },
  ],
  paymentTotals: [
    { method: "Cash", amount: ghs.format(1201.82), transactionCount: 18 },
  ],
};

describe("DailyManagerReport", () => {
  it("renders the applied automation outcome as a full daily status update", async () => {
    const html = await render(<DailyManagerReport {...baseProps} />);

    expect(html).toContain("Athena daily report");
    expect(html).toContain("max-width:640px;background-color:#ffffff");
    expect(html).not.toContain(
      "max-width:640px;background-color:#ffffff;border:1px solid #e2e3e6;border-radius:8px",
    );
    expect(html).toContain("Completed under policy");
    expect(html).toContain("Athena completed EOD Review under store policy.");
    expect(html).toContain("No follow-up needed for this operating day.");
    expect(html).toContain("GH₵12,430");
    expect(html).toContain("84 transactions");
    expect(html).toContain("1 report");
    expect(html).not.toContain("1 reports");
    expect(html).toContain("View EOD Review");
    expect(html).toContain("↗");
    expect(html).not.toContain("lucide-");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("Athena keeps the full close record");
  });

  it("supports a bordered report frame", async () => {
    const html = await render(
      <DailyManagerReport {...baseProps} frameVariant="bordered" />,
    );

    expect(html).toContain("Athena daily report");
    expect(html).toContain(
      "max-width:640px;background-color:#ffffff;border:1px solid #e2e3e6;border-radius:8px",
    );
  });

  it("does not fill omitted production sections with preview defaults", async () => {
    const html = await render(
      <DailyManagerReport
        storeName="Wigclub East Legon"
        operatingDate="Friday, July 3"
        completedAt="8:42 PM"
        completedBy="Athena"
        storeCurrency="GHS"
        status="prepared"
        reportUrl="https://athena.wigclub.store/wigclub/store/wigclub/operations"
      />,
    );

    expect(html).toContain("Ready for manager review");
    expect(html).not.toContain("Review the close when you are ready.");
    expect(html).toContain("Manager review");
    expect(html).toContain(
      "Review EOD Review before completing the store day.",
    );
    expect(html).not.toContain("Register session is still open");
    expect(html).not.toContain("Front Counter is still open.");
    expect(html).not.toContain(
      "Final cash count and variance will be available after the register is closed.",
    );
    expect(html).not.toContain("opening team");
    expect(html).not.toContain("Cash variance");
    expect(html).not.toContain("GH₵1,201.82");
    expect(html).not.toContain("Expected cash");
    expect(html).not.toContain("Counted cash");
    expect(html).not.toContain("Cash deposit");
    expect(html).not.toContain("Net variance");
    expect(html).not.toContain("TXN-1048 | GH₵220");
    expect(html).not.toContain("GHS 1,244");
    expect(html).not.toContain("No additional manager notes were added.");
  });

  it("keeps preview sample data explicit for email previews", async () => {
    const html = await render(
      <DailyManagerReport {...dailyManagerReportPreviewProps} />,
    );

    expect(html).toContain("Ready for manager review");
    expect(html).toContain("Register session is still open");
    expect(html).toContain("Front Counter is still open.");
    expect(html).toContain("GH₵1,201.82");
    expect(html).toContain("Expected cash");
  });

  it("degrades incomplete runtime payloads without using preview status defaults", async () => {
    const html = await render(
      <DailyManagerReport
        {...({
          completedAt: "8:42 PM",
          completedBy: "Athena",
          operatingDate: "Friday, July 3",
          reportUrl:
            "https://athena.wigclub.store/wigclub/store/wigclub/operations",
          storeName: "Wigclub East Legon",
        } as DailyManagerReportProps)}
      />,
    );

    expect(html).toContain("Status unavailable");
    expect(html).toContain("Open Athena to review the daily report.");
    expect(html).not.toContain("Ready for manager review");
    expect(html).not.toContain("Register session is still open");
    expect(html).not.toContain("GH₵1,201.82");
  });

  it("groups payment totals into amount-first payment columns", async () => {
    const html = await render(
      <DailyManagerReport
        {...baseProps}
        paymentTotals={[
          { method: "Cash", amount: ghs.format(1201.82), transactionCount: 18 },
          { method: "Card", amount: ghs.format(8420), transactionCount: 52 },
          {
            method: "Mobile money",
            amount: ghs.format(2808.18),
            transactionCount: 14,
          },
        ]}
      />,
    );

    expect(html).toContain("GH₵1,201.82");
    expect(html).toContain("18 transactions");
    expect(html).toContain("52 transactions");
    expect(html).toContain("14 transactions");
    expect(html).not.toContain("lucide-banknote");
    expect(html).not.toContain("lucide-credit-card");
    expect(html).not.toContain("lucide-smartphone");
    expect(html).toContain("width:50%");
    expect(html).toContain("Payment mix");
    expect(html).toContain("Cash position");
    expect(html).not.toContain("Cash and payments");
    expect(html.indexOf("Cash position")).toBeLessThan(
      html.indexOf("Payment mix"),
    );
  });

  it("renders prior-day comparisons for every reported amount and count", async () => {
    const html = await render(
      <DailyManagerReport
        {...baseProps}
        summaryMetrics={[
          {
            comparison: "20% higher vs prior day",
            detail: "10 transactions",
            detailComparison: "25% higher vs prior day",
            label: "Sales",
            value: ghs.format(12000),
          },
        ]}
        cashMetrics={[
          {
            comparison: "11% lower vs prior day",
            label: "Expected cash",
            value: ghs.format(1780),
          },
        ]}
        paymentTotals={[
          {
            amount: ghs.format(1200),
            amountComparison: "20% higher vs prior day",
            method: "Mobile money",
            transactionCount: 6,
            transactionCountComparison: "50% higher vs prior day",
          },
        ]}
      />,
    );

    expect(html).toContain("↑ 20% sales");
    expect(html).toContain("↑ 25% transactions");
    expect(html).toContain("↓ 11%");
    expect(html).toContain("↑ 50% transactions");
  });

  it("color codes net variance in the cash position section", async () => {
    const html = await render(
      <DailyManagerReport
        {...baseProps}
        cashMetrics={[
          { label: "Expected cash", value: ghs.format(1244) },
          { label: "Counted cash", value: ghs.format(1201.82) },
          { label: "Net variance", value: ghs.format(-42.18) },
        ]}
      />,
    );

    expect(html).toContain("Cash position");
    expect(html).not.toContain("Cash deposit");
    expect(html).toContain("Counted cash");
    expect(html).toContain("Net variance");
    expect(html).toContain("GH₵-42.18");
    expect(html).toContain("color:#dc4438");
  });

  it("renders only opening handoff in attention before the summary", async () => {
    const html = await render(
      <DailyManagerReport
        {...baseProps}
        status="applied"
        reviewedItems={[
          {
            title: "Cash variance",
            message: `Expected ${ghs.format(1244)}`,
            meta: "Reviewed during close",
          },
        ]}
        carryForwardItems={[
          {
            title: "Opening handoff",
            message: "Review register cash handoff before trading.",
          },
        ]}
      />,
    );

    expect(html).toContain("Completed under policy");
    expect(html).not.toContain("Cash variance");
    expect(html).toContain("Opening handoff");
    expect(html).toContain("1 item for the next opening");
    expect(html).not.toContain("opening team");
    expect(html).not.toContain("1 follow-up");
    expect(html).not.toContain("1 carry-forward</p>");
    expect(html).toContain("Review before the next store day starts.");
    expect(html).not.toContain(
      "1 carry-forward item | Visible in the next operating day&#x27;s opening workflow",
    );
    expect(html).not.toContain("Review register cash handoff before trading.");
    expect(html).toContain("Next opening");
    expect(html).not.toContain(">Attention<");
    expect(html.indexOf("Next opening")).toBeLessThan(
      html.indexOf("Operating summary"),
    );
  });

  it("renders blocker copy for blocked reports", async () => {
    const html = await render(
      <DailyManagerReport
        {...baseProps}
        status="failed"
        blockers={[
          {
            title: "Register session open",
            message: "Front Counter is still open.",
          },
        ]}
      />,
    );

    expect(html).toContain("Automation needs attention");
    expect(html).toContain(
      "Athena could not complete the automated EOD check.",
    );
    expect(html).toContain("Required action");
    expect(html).toContain("Open EOD Review");
    expect(html).toContain("Register session open");
    expect(html).toContain("Front Counter is still open.");
    expect(html).toContain(
      "Final cash count and variance will be available after the register is closed.",
    );
    expect(html).toContain("Expected cash");
    expect(html).not.toContain("Counted cash");
    expect(html).not.toContain("Net variance");
    expect(html).toContain("1 blocker");
  });
});

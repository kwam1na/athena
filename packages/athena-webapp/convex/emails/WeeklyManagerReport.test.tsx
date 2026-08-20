import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import WeeklyManagerReportPreview, {
  WeeklyManagerReport,
  weeklyManagerReportPreviewProps,
} from "./WeeklyManagerReport";

describe("WeeklyManagerReport preview", () => {
  it("renders the accepted weekly briefing and owner action", async () => {
    const html = await render(<WeeklyManagerReportPreview />);

    expect(html).toContain("Week complete");
    expect(html.replaceAll(/<!--.*?-->/g, "")).toContain(
      "Accepted Aug 8 at 8:47 PM by Athena",
    );
    expect(html).toContain(weeklyManagerReportPreviewProps.storeName);
    expect(html).toContain("GH₵27,455");
    expect(html).toContain("78");
    expect(html).toContain("Completed POS transactions");
    expect(html).toContain("11% higher than prior week");
    expect(html).toContain("18 more units than prior week");
    expect(html).toContain("Close variance");
    expect(html).toContain("Counted cash variance");
    expect(html).toContain("Counted cash was GH₵320 over.");
    expect(html).toContain("Inventory attention");
    expect(html).toContain("View weekly report");
    expect(html).toContain(weeklyManagerReportPreviewProps.reportUrl);
    expect(html).toContain("Top items by units sold");
    expect(html).toContain("Silk Press 18");
    expect(html).toContain("Deep Wave 22");
    expect(html).toContain("Kinky Straight 16");
    expect(html).toContain("View all top movers");
    expect(html).toContain(
      weeklyManagerReportPreviewProps.topItemsUrl.replaceAll("&", "&amp;"),
    );
    expect(html).toContain("Executive summary");
    const refundsStart = html.indexOf("Refunds");
    const transactionsStart = html.indexOf("Transactions", refundsStart);
    expect(html.slice(refundsStart, transactionsStart)).not.toContain(
      "78 transactions",
    );
    expect(html.indexOf("Executive summary")).toBeLessThan(
      html.indexOf("Weekly performance"),
    );
    expect(html.indexOf("Weekly performance")).toBeLessThan(
      html.indexOf("Payment mix"),
    );
    expect(html.indexOf("Payment mix")).toBeLessThan(
      html.indexOf("Item movement"),
    );
  });

  it("keeps reporting qualifications visible in the preview", async () => {
    const html = await render(<WeeklyManagerReportPreview />);

    expect(html).toContain("This weekly report is ready to review");
    expect(html).toContain("All scheduled days are closed");
    expect(html).not.toContain("6 of 6 scheduled days");
    expect(html).toContain("Merchandise margin unavailable");
  });

  it("keeps weekly payment and expense evidence value-first and compact", async () => {
    const html = await render(<WeeklyManagerReportPreview />);

    expect(html).toContain("Payment mix");
    expect(html).toContain("tender uses");
    expect(html).toContain("Top expense products by spend");
    expect(html).toContain("Top expense products by quantity");
    expect(html).toContain("Expenses");
    expect(html).toContain("Total expenses");
    expect(html).toContain("GH₵625");
    expect(html.indexOf("Total expenses")).toBeLessThan(
      html.indexOf("Top expense products by spend"),
    );
    expect(html).toContain("Variance");
    expect(html).toContain("other products");
    expect(html.indexOf("Payment mix")).toBeLessThan(
      html.indexOf("Top expense products by spend"),
    );

    const expenseHeadingStart = html.indexOf("Top expense products by spend");
    const firstExpenseRowStart = html.indexOf("Lace remover");
    expect(html.slice(expenseHeadingStart, firstExpenseRowStart)).not.toContain(
      "6 of 6 scheduled days",
    );

    const remainderLabelIndex = html.indexOf("6 other products");
    const remainderRowStart = html.lastIndexOf("<table", remainderLabelIndex);
    expect(html.slice(remainderRowStart, remainderLabelIndex)).not.toContain(
      "border-bottom",
    );
  });

  it("renders zero-at-partial, unavailable, and rounding disclosures", async () => {
    const html = await render(
      <WeeklyManagerReport
        {...weeklyManagerReportPreviewProps}
        notes="Payment mix reflects 4 of 6 scheduled days covered. Shares may not total 100% due to rounding."
        reportSections={[
          {
            title: "Close variance",
            message:
              "Not available — no completed Daily Closes contain this information.",
          },
          {
            title: "Counted cash variance",
            message: "Counted cash matched across covered days.",
            meta: "Based on 4 of 6 scheduled days",
          },
        ]}
      />,
    );

    expect(html).toContain(
      "Not available — no completed Daily Closes contain this information.",
    );
    expect(html).toContain("Counted cash matched across covered days.");
    expect(html).toContain("Based on 4 of 6 scheduled days");
    expect(html).toContain(
      "Payment mix reflects 4 of 6 scheduled days covered.",
    );
    expect(html).toContain("Shares may not total 100% due to rounding.");
    expect(html).not.toContain("Counted cash matched across the week.");
  });
});

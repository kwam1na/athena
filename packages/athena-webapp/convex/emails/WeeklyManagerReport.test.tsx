import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import WeeklyManagerReportPreview, {
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
    expect(html).toContain("18 more units than prior week");
    expect(html).toContain("Close variance");
    expect(html).toContain("Inventory attention");
    expect(html).toContain("View weekly report");
    expect(html).toContain(weeklyManagerReportPreviewProps.reportUrl);
    expect(html).toContain("Top items by units sold");
    expect(html).toContain("Silk Press 18");
    expect(html).toContain("View all top movers");
    expect(html).toContain(
      weeklyManagerReportPreviewProps.topItemsUrl.replaceAll("&", "&amp;"),
    );
    expect(html).toContain("Executive summary");
    expect(html.indexOf("Executive summary")).toBeLessThan(
      html.indexOf("Weekly performance"),
    );
    expect(html.indexOf("Payments")).toBeLessThan(
      html.indexOf("Close variance"),
    );
  });

  it("keeps reporting qualifications visible in the preview", async () => {
    const html = await render(<WeeklyManagerReportPreview />);

    expect(html).toContain("This weekly report is ready to review");
    expect(html).toContain("6 of 6 scheduled days closed");
    expect(html).toContain("Merchandise margin unavailable");
  });
});

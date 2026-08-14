import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import StaleDailyCloseAlertPreview, {
  StaleDailyCloseAlert,
  staleDailyCloseAlertPreviewProps,
} from "./StaleDailyCloseAlert";

describe("StaleDailyCloseAlert", () => {
  it("renders the agreed stale-day message and restrained action", async () => {
    const html = await render(<StaleDailyCloseAlertPreview />);

    expect(html).toContain("Wigclub<!-- --> · EOD Review");
    expect(html).toContain("Still open after <!-- -->2");
    expect(html).toContain("has remained open for 2 days");
    expect(html.match(/Wednesday, Aug 12/g)).toHaveLength(1);
    expect(html).toContain(
      "Athena has continued checking it but cannot complete the close",
    );
    expect(html).toContain("An open register session is preventing automatic");
    expect(html).toContain("Athena will continue retrying");
    expect(html).toContain("Review EOD Review");
    expect(html).toContain(staleDailyCloseAlertPreviewProps.reportUrl);
    expect(html).toContain("background-color:transparent");
    expect(html).toContain("border:1px solid #e2e3e6");
  });

  it("falls back to calm generic guidance when blockers are unavailable", async () => {
    const html = await render(
      <StaleDailyCloseAlert
        {...staleDailyCloseAlertPreviewProps}
        blockerSummaries={[]}
      />,
    );

    expect(html).toContain(
      "Review the remaining items before completing EOD Review.",
    );
  });
});

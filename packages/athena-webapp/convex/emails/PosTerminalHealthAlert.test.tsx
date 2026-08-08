import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import PosTerminalHealthAlertPreview, {
  PosTerminalHealthAlert,
  posTerminalHealthAlertPreviewProps,
} from "./PosTerminalHealthAlert";

describe("PosTerminalHealthAlert", () => {
  it("renders the default React Email preview without runtime props", async () => {
    const html = await render(<PosTerminalHealthAlertPreview />);

    expect(html).toContain(posTerminalHealthAlertPreviewProps.storeName);
    expect(html).toContain(posTerminalHealthAlertPreviewProps.terminalLabel);
    expect(html).toContain("Terminal needs attention");
    expect(html).toContain(posTerminalHealthAlertPreviewProps.healthUrl);
    expect(html).toContain("background-color:transparent");
    expect(html).toContain("border:1px solid #e2e3e6");
  });

  it("renders production alert data through the named component", async () => {
    const html = await render(
      <PosTerminalHealthAlert {...posTerminalHealthAlertPreviewProps} />,
    );

    for (const summary of posTerminalHealthAlertPreviewProps.conditionSummaries) {
      expect(html).toContain(summary);
    }
  });
});

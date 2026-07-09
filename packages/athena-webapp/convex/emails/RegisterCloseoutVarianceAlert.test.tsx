import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import RegisterCloseoutVarianceAlert, {
  registerCloseoutVarianceAlertPreviewProps,
  type RegisterCloseoutVarianceAlertProps,
} from "./RegisterCloseoutVarianceAlert";

const baseProps: RegisterCloseoutVarianceAlertProps = {
  countedCash: "GH₵1,201.82",
  currency: "GHS",
  expectedCash: "GH₵1,244.00",
  notes: "Cash counted twice before closeout.",
  operatingDate: "Friday, July 3",
  reason: "Variance exceeded the closeout approval threshold.",
  registerLabel: "Front counter / Register 2",
  reviewUrl:
    "https://athena.wigclub.store/wigclub/store/wigclub/cash-controls/registers/register-session-1",
  storeName: "Wigclub East Legon",
  submittedAt: "8:42 PM",
  submittedBy: "Ama Mensah",
  variance: "GH₵-42.18",
  varianceDirection: "short",
};

describe("RegisterCloseoutVarianceAlert", () => {
  it("renders a cash-controls email that follows the daily report structure", async () => {
    const html = await render(<RegisterCloseoutVarianceAlert {...baseProps} />);

    expect(html).toContain("Athena cash controls");
    expect(html).toContain("max-width:620px;background-color:#ffffff");
    expect(html).toContain("Wigclub East Legon");
    expect(html).toContain("Front counter / Register 2");
    expect(html).toContain("Friday, July 3");
    expect(html).toContain("Submitted with cash variance");
    expect(html).toContain("Expected cash");
    expect(html).toContain("Counted cash");
    expect(html).toContain("Cash short");
    expect(html).toContain("GH₵-42.18");
    expect(html).toContain("color:#dc4438");
    expect(html).toContain("Review register closeout");
    expect(html).toContain("lucide-arrow-up-right");
    expect(html).toContain(
      "Variance exceeded the closeout approval threshold.",
    );
    expect(html).toContain("Cash counted twice before closeout.");
  });

  it("labels positive variances as cash over", async () => {
    const html = await render(
      <RegisterCloseoutVarianceAlert
        {...baseProps}
        variance="GH₵12.00"
        varianceDirection="over"
      />,
    );

    expect(html).toContain("Cash over");
    expect(html).toContain("color:#b66b00");
    expect(html).not.toContain("Cash short");
  });

  it("formats raw stored variance amounts in review reasons with the store currency", async () => {
    const html = await render(
      <RegisterCloseoutVarianceAlert
        {...baseProps}
        countedCash="$320.00"
        currency="USD"
        expectedCash="$300.00"
        reason="Variance of 2000 exceeded the closeout approval threshold."
        variance="$20.00"
        varianceDirection="over"
      />,
    );

    expect(html).toContain(
      "Variance of $20 exceeded the closeout approval threshold",
    );
    expect(html).not.toContain("Variance of 2000 exceeded");
  });

  it("does not fill omitted production reason or notes with preview defaults", async () => {
    const { notes: _notes, reason: _reason, ...requiredProps } = baseProps;

    const html = await render(
      <RegisterCloseoutVarianceAlert {...requiredProps} />,
    );

    expect(html).toContain("Submitted with cash variance");
    expect(html).not.toContain("Review reason");
    expect(html).not.toContain("Closeout notes");
    expect(html).not.toContain(
      registerCloseoutVarianceAlertPreviewProps.reason,
    );
    expect(html).not.toContain(registerCloseoutVarianceAlertPreviewProps.notes);
  });

  it("keeps variance preview data explicit for email previews", async () => {
    const html = await render(
      <RegisterCloseoutVarianceAlert
        {...registerCloseoutVarianceAlertPreviewProps}
      />,
    );

    expect(html).toContain(registerCloseoutVarianceAlertPreviewProps.reason);
    expect(html).toContain(registerCloseoutVarianceAlertPreviewProps.notes);
  });

  it("degrades incomplete runtime payloads without inventing variance direction", async () => {
    const html = await render(
      <RegisterCloseoutVarianceAlert
        {...({
          countedCash: "GH₵1,201.82",
          expectedCash: "GH₵1,244.00",
          operatingDate: "Friday, July 3",
          registerLabel: "Front counter / Register 2",
          reviewUrl:
            "https://athena.wigclub.store/wigclub/store/wigclub/cash-controls/registers/register-session-1",
          storeName: "Wigclub East Legon",
          submittedAt: "8:42 PM",
          submittedBy: "Ama Mensah",
          variance: "GH₵-42.18",
        } as RegisterCloseoutVarianceAlertProps)}
      />,
    );

    expect(html).toContain("Cash variance");
    expect(html).not.toContain("Cash short");
    expect(html).not.toContain(
      registerCloseoutVarianceAlertPreviewProps.reason,
    );
    expect(html).not.toContain(registerCloseoutVarianceAlertPreviewProps.notes);
  });
});

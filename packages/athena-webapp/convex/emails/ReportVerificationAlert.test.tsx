import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import {
  ReportVerificationAlert,
  reportVerificationAlertPreviewProps,
  type ReportVerificationAlertProps,
} from "./ReportVerificationAlert";

const baseProps: ReportVerificationAlertProps = {
  ...reportVerificationAlertPreviewProps,
};

describe("ReportVerificationAlert", () => {
  it("renders the operational shell with the verification eyebrow and subject", async () => {
    const html = await render(<ReportVerificationAlert {...baseProps} />);

    expect(html).toContain("Athena report verification");
    expect(html).toContain("max-width:640px;background-color:#ffffff");
    expect(html).toContain("Wigclub");
    expect(html).toContain("Saturday, August 8");
    expect(html).toContain("Reported totals disagree with source records");
    expect(html).toContain("Review reports ↗");
    expect(html).toContain("background-color:transparent");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("lucide-");
  });

  it("renders compared-and-disagreeing fields under 'Checked and wrong'", async () => {
    const html = await render(<ReportVerificationAlert {...baseProps} />);

    expect(html).toContain("Checked and wrong");
    expect(html).toContain("Net sales");
    expect(html).toContain("GH₵12,930.00");
    expect(html).toContain("GH₵12,480.00");
    expect(html).toContain("Units sold");
    // Differences carry the alert colour; not-checked fields must not.
    expect(html).toContain("border-left:2px solid #dc4438");
  });

  it("renders withheld fields in their own 'not checked' section, never as differences", async () => {
    // R4: "unverified is not mismatched". A field verification declined to
    // make a claim about must be visually and textually separated from the
    // fields that were compared and disagreed.
    const html = await render(<ReportVerificationAlert {...baseProps} />);

    expect(html).toContain("Not checked");
    expect(html).toContain("Payments refunded");
    expect(html).toContain("Payment allocation coverage");
    expect(html).toContain(
      "finding no difference here would not have meant they agree",
    );
    // Its own panel accent, distinct from the difference accent.
    expect(html).toContain("border-left:3px solid #b66b00");
    expect(html).toContain("border-left:2px solid #b66b00");

    // The withheld field names appear only after the differences section, and
    // never inside a difference row (which always renders both sides).
    const differencesIndex = html.indexOf("Checked and wrong");
    const notCheckedIndex = html.indexOf("Not checked");
    expect(differencesIndex).toBeGreaterThan(-1);
    expect(notCheckedIndex).toBeGreaterThan(differencesIndex);
    expect(html).not.toContain("Payments refunded</strong>");
  });

  it("omits the not-checked section entirely when everything was checked", async () => {
    const html = await render(
      <ReportVerificationAlert {...baseProps} notCheckedFields={[]} />,
    );

    expect(html).toContain("Checked and wrong");
    expect(html).not.toContain("Not checked");
    expect(html).not.toContain("border-left:3px solid #b66b00");
  });

  it("labels explained differences as recorded rather than actionable", async () => {
    const html = await render(<ReportVerificationAlert {...baseProps} />);

    expect(html).toContain("Recorded, not alerted");
    expect(html).toContain("Units returned");
    expect(html).toContain("Known blind spot");
    expect(html).toContain("need no action");
  });

  it("drops the explained section when there is nothing to record", async () => {
    const html = await render(
      <ReportVerificationAlert {...baseProps} explainedDifferences={[]} />,
    );

    expect(html).not.toContain("Recorded, not alerted");
    expect(html).not.toContain("Units returned");
  });

  it("mentions the streak only once the discrepancy has survived a re-check", async () => {
    const first = await render(
      <ReportVerificationAlert {...baseProps} streakCount={1} />,
    );
    expect(first).not.toContain("consecutive checks");

    const repeated = await render(
      <ReportVerificationAlert {...baseProps} streakCount={4} />,
    );
    expect(repeated).toContain("4 consecutive checks");
  });

  it("frames a could-not-check subject as unverified rather than wrong", async () => {
    // The weekly config-defect escalation alerts with no differences at all:
    // claiming "totals disagree" there would be a false statement.
    const html = await render(
      <ReportVerificationAlert
        {...baseProps}
        differences={[]}
        explainedDifferences={[]}
        notCheckedFields={["Weekly schedule"]}
        subjectKindLabel="Week"
        subjectLabel="week of August 3"
      />,
    );

    expect(html).toContain("Verification could not complete");
    expect(html).toContain("Nothing below is a confirmed difference.");
    expect(html).not.toContain("Checked and wrong");
    expect(html).toContain("Not checked");
    expect(html).toContain("Weekly schedule");
  });
});

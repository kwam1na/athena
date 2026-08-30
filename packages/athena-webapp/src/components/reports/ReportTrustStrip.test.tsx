import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportTrustStrip } from "./ReportTrustStrip";

describe("ReportTrustStrip projection freshness", () => {
  it.each(["pending", "blocked"] as const)(
    "labels %s snapshots without asserting fresh reconciliation",
    (projectionStatus) => {
      render(
        <ReportTrustStrip
          reportedDayCount={3}
          trust={{
            reconciledDays: 3,
            provisionalDays: 0,
            amendedDays: 0,
            projectionStatus,
          }}
        />,
      );
      expect(screen.getByTestId("report-trust-summary").textContent).toContain(
        "Showing the last completed snapshot",
      );
      expect(screen.queryByText(/3 of 3/)).toBeNull();
    },
  );
});

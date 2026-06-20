import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  formatOperationsMetricComparison,
  formatOperationsMetricHelper,
} from "./OperationsSummaryMetric";

describe("operations metric helpers", () => {
  it("renders missing prior data as none for the baseline", () => {
    render(
      <p>
        {formatOperationsMetricHelper({
          currentValue: 100,
          detail: "4 transactions",
          priorValue: undefined,
          priorWindowLabel: "yesterday",
        })}
      </p>,
    );

    expect(screen.getByText("4 transactions")).toBeInTheDocument();
    expect(screen.getByText("None yesterday")).toBeInTheDocument();
  });

  it("renders equal, increase, and decrease comparison states", () => {
    const { rerender } = render(
      <p>
        {formatOperationsMetricComparison({
          currentValue: 100,
          priorValue: 100,
          priorWindowLabel: "yesterday",
        })}
      </p>,
    );

    expect(screen.getByText("In line")).toBeInTheDocument();
    expect(screen.getByText("vs yesterday")).toBeInTheDocument();

    rerender(
      <p>
        {formatOperationsMetricComparison({
          currentValue: 125,
          priorValue: 100,
          priorWindowLabel: "yesterday",
        })}
      </p>,
    );

    expect(screen.getByText("+25%")).toBeInTheDocument();

    rerender(
      <p>
        {formatOperationsMetricComparison({
          currentValue: 75,
          priorValue: 100,
          priorWindowLabel: "yesterday",
        })}
      </p>,
    );

    expect(screen.getByText("-25%")).toBeInTheDocument();
  });
});

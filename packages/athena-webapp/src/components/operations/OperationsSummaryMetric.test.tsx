import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  formatOperationsMetricComparison,
  formatOperationsMetricHelper,
} from "./operationsMetricFormatting";

describe("operations metric helpers", () => {
  it("renders missing prior activity with operator-friendly copy", () => {
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
    expect(screen.getByText("No activity yesterday")).toBeInTheDocument();
  });

  it("renders historical missing prior activity without clipped phrasing", () => {
    render(
      <p>
        {formatOperationsMetricComparison({
          currentValue: 100,
          priorValue: 0,
          priorWindowLabel: "prior day",
        })}
      </p>,
    );

    expect(screen.getByText("No activity on prior day")).toBeInTheDocument();
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

  it("supports precomputed deltas and custom missing comparison copy", () => {
    const { rerender } = render(
      <p>
        {formatOperationsMetricComparison({
          deltaPercent: 24,
          priorValue: 100,
          priorWindowLabel: "yesterday",
        })}
      </p>,
    );

    expect(screen.getByText("+24%")).toBeInTheDocument();
    expect(screen.getByText("vs yesterday")).toBeInTheDocument();

    rerender(
      <p>
        {formatOperationsMetricHelper({
          currentValue: 100,
          detail: "3 payments",
          missingComparisonLabel: "No yesterday",
          priorValue: 0,
          priorWindowLabel: "yesterday",
        })}
      </p>,
    );

    expect(screen.getByText("No yesterday")).toBeInTheDocument();
    expect(screen.queryByText("+24%")).toBeNull();
  });

  it("can hide the comparison while keeping the metric detail", () => {
    render(
      <p>
        {formatOperationsMetricHelper({
          currentValue: 100,
          detail: "3 transactions",
          priorValue: 200,
          priorWindowLabel: "yesterday",
          showComparison: false,
        })}
      </p>,
    );

    expect(screen.getByText("3 transactions")).toBeInTheDocument();
    expect(screen.queryByText("vs yesterday")).toBeNull();
    expect(screen.queryByText("-50%")).toBeNull();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnimatedDataState } from "./AnimatedDataState";

describe("AnimatedDataState", () => {
  it("exits the current content before entering the next keyed state", async () => {
    const { rerender } = render(
      <AnimatedDataState stateKey="data" testId="data-state">
        <p>Data rows</p>
      </AnimatedDataState>,
    );

    const state = screen.getByTestId("data-state");
    expect(state).toHaveAttribute("data-motion", "data-state");
    expect(state).toHaveAttribute("data-state", "data");

    rerender(
      <AnimatedDataState stateKey="empty" testId="data-state">
        <p>No data</p>
      </AnimatedDataState>,
    );

    expect(state).toHaveAttribute("data-state", "empty");
    await waitFor(() => {
      expect(screen.getByText("No data")).toBeInTheDocument();
      expect(screen.queryByText("Data rows")).not.toBeInTheDocument();
    });
  });
});

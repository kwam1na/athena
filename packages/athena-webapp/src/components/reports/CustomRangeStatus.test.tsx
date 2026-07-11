import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomRangeStatus } from "./CustomRangeStatus";

describe("CustomRangeStatus", () => {
  it("announces progress and offers a retry after failure", () => {
    const { rerender } = render(
      <CustomRangeStatus progress={44.6} state="running" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("45% complete");
    const retry = vi.fn();
    rerender(<CustomRangeStatus onRetry={retry} state="failed" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

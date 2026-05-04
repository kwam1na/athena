import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ViewUsagePatterns } from "./view-patterns";

describe("ViewUsagePatterns", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  it("documents the primary View usage modes", () => {
    render(<ViewUsagePatterns />);

    expect(
      screen.getByRole("heading", { name: /view component usage/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/contained workspace/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/full-width operations/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/page-scrolling sections/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/borderless nested panes/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/state wrappers/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/width='full'/i)).toBeInTheDocument();
    expect(screen.getByText(/scrollMode='page'/i)).toBeInTheDocument();
    expect(screen.getByText(/hideBorder/i)).toBeInTheDocument();
  });
});

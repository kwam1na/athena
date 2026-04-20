import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AthenaFoundationsPage } from "./foundations-content";

describe("AthenaFoundationsPage", () => {
  it("documents the core Athena foundation sections and review cues", () => {
    render(<AthenaFoundationsPage />);

    expect(
      screen.getByRole("heading", {
        name: /athena semantic design foundations/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: /color roles/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /typography system/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /spacing and density/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /elevation and motion/i }),
    ).toBeInTheDocument();

    expect(screen.getAllByText(/shell \/ ink/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/signal \/ action/i)).not.toHaveLength(0);
    expect(screen.getByText(/display serif/i)).toBeInTheDocument();
    expect(screen.getByText(/standard workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/focus sweep/i)).toBeInTheDocument();
    for (const reviewButton of screen.getAllByRole("button", { name: /review/i })) {
      expect(reviewButton).toBeDisabled();
    }
  });
});

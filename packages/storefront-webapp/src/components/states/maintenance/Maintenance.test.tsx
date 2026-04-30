import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MaintenanceMode } from "./Maintenance";

describe("MaintenanceMode", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the fallback message without a store provider", () => {
    render(<MaintenanceMode />);

    expect(screen.getByText("We're updating our store...")).toBeInTheDocument();
    expect(
      screen.getByText(
        "We're working on bringing you amazing products. Check back soon!",
      ),
    ).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AthenaAdminShellPatterns,
  AthenaSidebarPattern,
} from "./admin-shell-patterns";

describe("Athena admin shell patterns", () => {
  it("renders a shell composition that reads like Athena's admin workspace", () => {
    render(<AthenaAdminShellPatterns />);

    expect(
      screen.getByRole("heading", {
        name: /athena admin shell patterns/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^northwind atelier$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^store$/i)).toBeInTheDocument();
    expect(screen.getByText(/^analytics$/i)).toBeInTheDocument();
    expect(screen.getByText(/bulk operations/i)).toBeInTheDocument();
    expect(screen.getByText(/open orders/i)).toBeInTheDocument();
    expect(screen.getByText(/pending reviews/i)).toBeInTheDocument();
    expect(screen.getByText(/loading surfaces/i)).toBeInTheDocument();
  });

  it("renders the sidebar preview without live app providers", () => {
    render(<AthenaSidebarPattern />);

    expect(screen.getByText(/^store$/i)).toBeInTheDocument();
    expect(screen.getByText(/^analytics$/i)).toBeInTheDocument();
    expect(screen.getByText(/bulk operations/i)).toBeInTheDocument();
    expect(screen.getByText(/reviews/i)).toBeInTheDocument();
  });
});

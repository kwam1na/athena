import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DashboardWorkspaceTemplate,
  DataWorkspaceTemplate,
  SettingsWorkspaceTemplate,
} from "./reference-fixtures";

describe("Athena reference templates", () => {
  it("renders the dashboard workspace hierarchy", () => {
    render(<DashboardWorkspaceTemplate />);

    expect(
      screen.getByRole("heading", {
        name: /northwind atlas dashboard/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /critical signals/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /primary revenue curve/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /today's actions/i }),
    ).toBeInTheDocument();
  });

  it("renders the data workspace review lanes", () => {
    render(<DataWorkspaceTemplate />);

    expect(
      screen.getByRole("heading", {
        name: /northwind atlas data workspace/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /exception lanes/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/approval queue/i)).toBeInTheDocument();
    expect(screen.getByText(/stale imports/i)).toBeInTheDocument();
  });

  it("renders the settings workspace guidance blocks", () => {
    render(<SettingsWorkspaceTemplate />);

    expect(
      screen.getByRole("heading", {
        name: /northwind atlas settings workspace/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /density guidance/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /permission matrix/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /settings rules/i }),
    ).toBeInTheDocument();
  });
});

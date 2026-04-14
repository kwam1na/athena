import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AthenaLoginReadyView } from "./_layout.index";

vi.mock("~/src/components/auth/Login", () => ({
  Login: () => <div>Mock Login</div>,
}));

describe("AthenaLoginReadyView", () => {
  it("exposes a stable login readiness hook", () => {
    render(<AthenaLoginReadyView />);

    expect(screen.getByTestId("athena-login-ready")).toBeInTheDocument();
    expect(screen.getByText("Mock Login")).toBeInTheDocument();
  });
});

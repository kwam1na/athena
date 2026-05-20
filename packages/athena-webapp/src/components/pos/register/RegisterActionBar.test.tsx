import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RegisterActionBar } from "./RegisterActionBar";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params: _params,
    search: _search,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    search?: unknown;
    to?: string;
  }) => {
    void _params;
    void _search;

    return (
      <a href={to ?? "#"} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock("../RegisterActions", () => ({
  RegisterActions: () => <div>register-actions</div>,
}));

vi.mock("./RegisterSessionPanel", () => ({
  RegisterSessionPanel: () => <div>session-panel</div>,
}));

const registerInfo = {
  customerName: "Walk-in customer",
  registerLabel: "Register 1",
  hasTerminal: true,
};

describe("RegisterActionBar", () => {
  it("shows opening float correction for managers", () => {
    render(
      <RegisterActionBar
        cashierCard={null}
        closeoutControl={{
          canCloseout: true,
          canShowOpeningFloatCorrection: true,
          canCorrectOpeningFloat: true,
          onRequestCloseout: vi.fn(),
          onRequestOpeningFloatCorrection: vi.fn(),
        }}
        registerInfo={registerInfo}
        sessionPanel={null}
      />,
    );

    expect(screen.getByRole("button", { name: /float/i })).toBeInTheDocument();
  });

  it("hides opening float correction for non-manager cashiers", () => {
    render(
      <RegisterActionBar
        cashierCard={null}
        closeoutControl={{
          canCloseout: true,
          canShowOpeningFloatCorrection: false,
          canCorrectOpeningFloat: false,
          onRequestCloseout: vi.fn(),
          onRequestOpeningFloatCorrection: vi.fn(),
        }}
        registerInfo={registerInfo}
        sessionPanel={null}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /float/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /closeout/i }),
    ).toBeInTheDocument();
  });

  it("shows the signed-in cashier beside register actions", () => {
    render(
      <RegisterActionBar
        cashierCard={{
          cashierName: "Ato K.",
          onSignOut: vi.fn(),
        }}
        closeoutControl={null}
        registerInfo={registerInfo}
        sessionPanel={null}
      />,
    );

    expect(screen.getByText("Cashier")).toBeInTheDocument();
    expect(screen.getByText("Ato K.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });
});

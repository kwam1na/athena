import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "./ProtectedRoute";

const mocks = vi.hoisted(() => ({
  usePermissions: vi.fn(),
}));

vi.mock("../hooks/usePermissions", () => ({
  usePermissions: mocks.usePermissions,
}));

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
  });

  it("allows manager-protected routes for full admins and active manager elevation", () => {
    mocks.usePermissions.mockReturnValue({
      hasFinancialDetailsAccess: true,
      isLoading: false,
      role: "pos_only",
    });

    const { rerender } = render(
      <ProtectedRoute requires="manager">
        <div>Manager content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText("Manager content")).toBeInTheDocument();

    mocks.usePermissions.mockReturnValue({
      hasFinancialDetailsAccess: true,
      isLoading: false,
      role: "full_admin",
    });

    rerender(
      <ProtectedRoute requires="manager">
        <div>Manager content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText("Manager content")).toBeInTheDocument();
  });

  it("blocks manager-protected routes for POS-only sessions without elevation", () => {
    mocks.usePermissions.mockReturnValue({
      hasFinancialDetailsAccess: false,
      isLoading: false,
      role: "pos_only",
    });

    render(
      <ProtectedRoute requires="manager">
        <div>Manager content</div>
      </ProtectedRoute>,
    );

    expect(screen.queryByText("Manager content")).not.toBeInTheDocument();
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });
});

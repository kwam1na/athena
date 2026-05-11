import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Index } from "./index";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  useAuth: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  useNavigate: () => mocked.navigate,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: mocked.useAuth,
}));

vi.mock("convex/react", () => ({
  useQuery: mocked.useQuery,
}));

vi.mock("@/components/OrganizationsView", () => ({
  default: () => <div data-testid="organizations-view">Organizations view</div>,
}));

vi.mock("@/components/ui/modals/organization-modal", () => ({
  OrganizationModal: () => <div data-testid="organization-modal" />,
}));

describe("Index route", () => {
  beforeEach(() => {
    mocked.navigate.mockReset();
    mocked.useAuth.mockReset();
    mocked.useQuery.mockReset();
  });

  it("stays empty while the authenticated user is loading", () => {
    mocked.useAuth.mockReturnValue({ user: undefined, isLoading: true });
    mocked.useQuery.mockReturnValue(undefined);

    render(<Index />);

    expect(screen.queryByText("Loading workspace...")).not.toBeInTheDocument();
    expect(screen.queryByTestId("organizations-view")).not.toBeInTheDocument();
    expect(mocked.navigate).not.toHaveBeenCalled();
  });

  it("redirects signed-out users to login", async () => {
    mocked.useAuth.mockReturnValue({ user: null, isLoading: false });
    mocked.useQuery.mockReturnValue(undefined);

    render(<Index />);

    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" })
    );
  });

  it("redirects authenticated users with organizations into the organization route", async () => {
    mocked.useAuth.mockReturnValue({
      user: { _id: "athena-user-1" },
      isLoading: false,
    });
    mocked.useQuery.mockReturnValue([{ _id: "org-1", slug: "wigclub" }]);

    render(<Index />);

    await waitFor(() =>
      expect(mocked.navigate).toHaveBeenCalledWith({
        to: "/$orgUrlSlug",
        params: { orgUrlSlug: "wigclub" },
      })
    );
  });
});

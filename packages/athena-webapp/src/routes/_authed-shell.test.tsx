import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { AuthenticatedLayout } from "./_authed";

const mocked = vi.hoisted(() => ({
  navigationShortcuts: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
}));

vi.mock("@/hooks/use-navigation-keyboard-shortcuts", () => ({
  useNavigationKeyboardShortcuts: mocked.navigationShortcuts,
}));

vi.mock("@/components/app-update/UpdateReadyBanner", () => ({
  UpdateReadyBanner: () => <div data-testid="update-ready-banner" />,
}));

vi.mock("./-authed-layout", () => ({
  default: () => <div data-testid="authenticated-layout" />,
}));

beforeEach(() => {
  mocked.navigationShortcuts.mockReset();
});

it("owns authenticated operational chrome exactly once", () => {
  render(<AuthenticatedLayout />);

  expect(screen.getByTestId("update-ready-banner")).toBeInTheDocument();
  expect(screen.getByTestId("authenticated-layout")).toBeInTheDocument();
  expect(mocked.navigationShortcuts).toHaveBeenCalledTimes(1);
});

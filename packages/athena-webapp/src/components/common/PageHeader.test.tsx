import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposedPageHeader, NavigateBackButton } from "./PageHeader";

const mocks = vi.hoisted(() => ({
  navigateBack: vi.fn(),
  useSearch: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: mocks.useSearch,
}));

vi.mock("~/src/hooks/use-navigate-back", () => ({
  useNavigateBack: () => mocks.navigateBack,
}));

vi.mock("./FadeIn", () => ({
  FadeIn: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

describe("PageHeader Remote Assist controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSearch.mockReturnValue({ o: "/previous" });
  });

  it("marks NavigateBackButton as a stable Remote Assist control", () => {
    render(<NavigateBackButton />);

    expect(screen.getByRole("button", { name: /go back/i })).toHaveAttribute(
      "data-remote-assist-control",
      "page-header-back",
    );
    expect(screen.getByRole("button", { name: /go back/i })).toHaveAttribute(
      "data-remote-assist-control-id",
      "page-header-back",
    );
    expect(screen.getByRole("button", { name: /go back/i })).toHaveAttribute(
      "data-remote-assist-control-label",
      "Go back",
    );
    expect(screen.getByRole("button", { name: /go back/i })).toHaveAttribute(
      "data-remote-assist-control-role",
      "button",
    );
  });

  it("marks ComposedPageHeader back button as a stable Remote Assist control", () => {
    render(<ComposedPageHeader leadingContent={<h1>Register session</h1>} />);

    expect(screen.getByRole("button", { name: /go back/i })).toHaveAttribute(
      "data-remote-assist-control",
      "page-header-back",
    );
  });

  it("does not mark disabled ComposedPageHeader back buttons", () => {
    render(
      <ComposedPageHeader
        disableBackButton
        leadingContent={<h1>Updating product</h1>}
      />,
    );

    expect(screen.getByRole("button", { name: /go back/i })).not.toHaveAttribute(
      "data-remote-assist-control",
    );
  });
});

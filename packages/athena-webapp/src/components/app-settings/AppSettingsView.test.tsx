import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppSettingsView } from "./AppSettingsView";

const mocks = vi.hoisted(() => ({
  setDarkThemeVariant: vi.fn(),
  useAthenaTheme: vi.fn(),
}));

vi.mock("@/lib/theme", async () => {
  const actual = await vi.importActual<typeof import("@/lib/theme")>(
    "@/lib/theme",
  );

  return {
    ...actual,
    setAthenaThemeModeWithTransition: vi.fn(),
    useAthenaTheme: mocks.useAthenaTheme,
  };
});

vi.mock("@/components/View", () => ({
  default: ({
    children,
    scrollMode,
  }: {
    children: React.ReactNode;
    scrollMode?: string;
  }) => (
    <section data-scroll-mode={scrollMode} data-testid="app-page">
      {children}
    </section>
  ),
}));

vi.mock("@/components/common/FadeIn", () => ({
  FadeIn: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div className={className} data-testid="page-container">
      {children}
    </div>
  ),
}));

describe("AppSettingsView", () => {
  it("renders inside the app page wrapper", () => {
    mocks.useAthenaTheme.mockReturnValue({
      mode: "light",
      resolvedTheme: "light",
      darkThemeVariant: "charcoal",
      setDarkThemeVariant: mocks.setDarkThemeVariant,
    });

    render(<AppSettingsView />);

    expect(screen.getByTestId("app-page")).toHaveAttribute(
      "data-scroll-mode",
      "page",
    );
    expect(screen.getByTestId("page-container")).toHaveClass(
      "container",
      "mx-auto",
      "py-layout-xl",
    );
  });

  it("only shows dark palette options when dark mode is selected", () => {
    mocks.useAthenaTheme.mockReturnValue({
      mode: "system",
      resolvedTheme: "dark",
      darkThemeVariant: "charcoal",
      setDarkThemeVariant: mocks.setDarkThemeVariant,
    });

    const { rerender } = render(<AppSettingsView />);

    expect(
      screen.queryByRole("heading", { name: "Dark palette" }),
    ).not.toBeInTheDocument();

    mocks.useAthenaTheme.mockReturnValue({
      mode: "dark",
      resolvedTheme: "dark",
      darkThemeVariant: "charcoal",
      setDarkThemeVariant: mocks.setDarkThemeVariant,
    });

    rerender(<AppSettingsView />);

    expect(
      screen.getByRole("heading", { name: "Dark palette" }),
    ).toBeInTheDocument();
  });
});

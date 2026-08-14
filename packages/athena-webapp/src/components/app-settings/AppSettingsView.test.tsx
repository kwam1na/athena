import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppSettingsView } from "./AppSettingsView";

const mocks = vi.hoisted(() => ({
  requestAthenaSunCycleMode: vi.fn(),
  setDarkThemeVariant: vi.fn(),
  useAthenaTheme: vi.fn(),
}));

vi.mock("@/lib/theme", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/theme")>("@/lib/theme");

  return {
    ...actual,
    requestAthenaSunCycleMode: mocks.requestAthenaSunCycleMode,
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
  beforeEach(() => {
    mocks.requestAthenaSunCycleMode.mockReset();
  });

  it("renders inside the app page wrapper", () => {
    mocks.useAthenaTheme.mockReturnValue({
      mode: "light",
      resolvedTheme: "light",
      darkThemeVariant: "charcoal",
      setDarkThemeVariant: mocks.setDarkThemeVariant,
    });

    render(<AppSettingsView />);

    expect(
      screen.getByText("Choose how Athena looks in this workspace."),
    ).toBeInTheDocument();
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

  it("shows sentence-case active appearance metadata and the next solar transition", () => {
    mocks.useAthenaTheme.mockReturnValue({
      mode: "sun-cycle",
      resolvedTheme: "light",
      darkThemeVariant: "charcoal",
      setDarkThemeVariant: mocks.setDarkThemeVariant,
      sunCycle: {
        nextResolvedTheme: "dark",
        nextTransitionAt: new Date("2026-08-13T18:30:00.000Z").getTime(),
      },
    });

    render(<AppSettingsView />);

    const status = screen.getByText(/Active appearance/);
    expect(status).toHaveTextContent(
      /Active appearance\s*·\s*Light\s*·\s*Dark at/,
    );
    expect(status).not.toHaveClass("uppercase");
    expect(screen.getByRole("button", { name: /Sun cycle/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps the current selection and shows recovery guidance when location is denied", async () => {
    mocks.requestAthenaSunCycleMode.mockResolvedValue({
      ok: false,
      reason: "permission-denied",
    });
    mocks.useAthenaTheme.mockReturnValue({
      mode: "light",
      resolvedTheme: "light",
      darkThemeVariant: "charcoal",
      setDarkThemeVariant: mocks.setDarkThemeVariant,
      sunCycle: null,
    });

    render(<AppSettingsView />);
    fireEvent.click(screen.getByRole("button", { name: /Sun cycle/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Location access is off",
      ),
    );
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

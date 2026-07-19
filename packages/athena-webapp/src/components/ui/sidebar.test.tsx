import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SidebarInset,
  SidebarMenuButton,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

beforeEach(() => {
  document.cookie = "sidebar_state=; path=/; max-age=0";
});

function SidebarToggleProbe() {
  const { open, setOpen } = useSidebar();

  return (
    <>
      <div data-testid="sidebar-open-state">{String(open)}</div>
      <button type="button" onClick={() => setOpen(!open)}>
        Toggle
      </button>
    </>
  );
}

describe("SidebarMenuButton", () => {
  it("marks enabled menu buttons as Remote Assist controls", () => {
    render(
      <SidebarProvider>
        <SidebarMenuButton asChild>
          <a href="/wigclub/store/wigclub/pos">Point of Sale</a>
        </SidebarMenuButton>
      </SidebarProvider>,
    );

    expect(screen.getByRole("link", { name: /point of sale/i })).toHaveAttribute(
      "data-remote-assist-control",
      "sidebar-menu-button",
    );
  });

  it("does not mark disabled menu buttons as Remote Assist controls", () => {
    render(
      <SidebarProvider>
        <SidebarMenuButton disabled>Procurement</SidebarMenuButton>
      </SidebarProvider>,
    );

    expect(screen.getByRole("button", { name: /procurement/i })).not.toHaveAttribute(
      "data-remote-assist-control",
    );
  });
});

describe("SidebarInset", () => {
  it("uses the app canvas token for the shared content inset", () => {
    render(
      <SidebarProvider>
        <SidebarInset>Workspace</SidebarInset>
      </SidebarProvider>,
    );

    expect(screen.getByText("Workspace")).toHaveClass("bg-app-canvas");
  });
});

describe("SidebarProvider", () => {
  it("restores persisted sidebar state when no explicit default is provided", () => {
    document.cookie = "sidebar_state=false; path=/";

    render(
      <SidebarProvider>
        <SidebarToggleProbe />
      </SidebarProvider>,
    );

    expect(screen.getByTestId("sidebar-open-state")).toHaveTextContent("false");
  });

  it("preserves persisted sidebar state over the default", () => {
    document.cookie = "sidebar_state=true; path=/";

    render(
      <SidebarProvider defaultOpen={false}>
        <SidebarToggleProbe />
      </SidebarProvider>,
    );

    expect(screen.getByTestId("sidebar-open-state")).toHaveTextContent("true");
  });

  it("uses the default when no persisted sidebar state exists", () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <SidebarToggleProbe />
      </SidebarProvider>,
    );

    expect(screen.getByTestId("sidebar-open-state")).toHaveTextContent("false");
  });

  it("does not persist automatic sidebar state changes when persistence is disabled", () => {
    document.cookie = "sidebar_state=true; path=/";

    render(
      <SidebarProvider defaultOpen persistOpenState={false}>
        <SidebarToggleProbe />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));

    expect(document.cookie).toContain("sidebar_state=true");
  });
});

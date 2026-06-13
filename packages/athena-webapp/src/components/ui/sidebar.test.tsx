import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  SidebarMenuButton,
  SidebarProvider,
} from "@/components/ui/sidebar";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

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

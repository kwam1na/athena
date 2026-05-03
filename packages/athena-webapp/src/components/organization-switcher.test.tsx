import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OrganizationSwitcher from "./organization-switcher";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  useGetStores: vi.fn().mockReturnValue([]),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocked.navigate,
  useParams: () => ({ orgUrlSlug: "athena" }),
}));

vi.mock("../hooks/useGetActiveStore", () => ({
  useGetStores: mocked.useGetStores,
}));

vi.mock("@/hooks/useOrganizationModal", () => ({
  useOrganizationModal: () => ({}),
}));

vi.mock("./ui/modals/overlay-modal", () => ({
  OverlayModal: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("./ui/icons", () => ({
  Icons: {
    spinner: () => <div />,
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: any) => <div>{children}</div>,
  CommandGroup: ({ children }: any) => <div>{children}</div>,
  CommandItem: ({ children, onSelect }: any) => (
    <button onClick={() => onSelect?.()}>{children}</button>
  ),
  CommandList: ({ children }: any) => <div>{children}</div>,
  CommandSeparator: () => <hr />,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
}));

describe("OrganizationSwitcher", () => {
  beforeEach(() => {
    mocked.navigate.mockReset();
  });

  it("only exposes organization switching actions", () => {
    render(
      <OrganizationSwitcher
        items={[
          {
            _id: "org-1",
            name: "Athena",
            slug: "athena",
          } as any,
        ]}
      />
    );

    expect(
      screen.getByRole("combobox", { name: /select an organization/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });
});

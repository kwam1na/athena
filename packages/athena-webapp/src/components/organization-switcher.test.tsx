import { render, screen } from "@testing-library/react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Organization } from "~/types";
import type { Id } from "~/convex/_generated/dataModel";

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
  OverlayModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("./ui/icons", () => ({
  Icons: {
    spinner: () => <div />,
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <button onClick={() => onSelect?.()}>{children}</button>
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandSeparator: () => <hr />,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: HTMLAttributes<HTMLDivElement>) => (
    <div>{children}</div>
  ),
}));

const organizations: Organization[] = [
  {
    _id: "org-1" as Id<"organization">,
    _creationTime: 1,
    createdByUserId: "user-1" as Id<"athenaUser">,
    name: "Athena",
    slug: "athena",
  },
];

describe("OrganizationSwitcher", () => {
  beforeEach(() => {
    mocked.navigate.mockReset();
  });

  it("only exposes organization switching actions", () => {
    render(
      <OrganizationSwitcher
        items={organizations}
      />
    );

    expect(
      screen.getByRole("combobox", { name: /select an organization/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("sizes the trigger to its selected organization content", () => {
    render(
      <OrganizationSwitcher
        items={organizations}
      />
    );

    expect(
      screen.getByRole("combobox", { name: /select an organization/i })
    ).toHaveClass("w-fit", "max-w-[14rem]");
  });
});

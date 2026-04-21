import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OrganizationSwitcher from "./organization-switcher";
import { LOGGED_IN_USER_ID_KEY } from "../lib/constants";

const mocked = vi.hoisted(() => ({
  navigate: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  useGetStores: vi.fn().mockReturnValue([]),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signOut: mocked.signOut,
  }),
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
    mocked.signOut.mockReset();
  });

  it("clears both local state and the Convex auth session on logout", async () => {
    const user = userEvent.setup();

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

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(mocked.signOut).toHaveBeenCalled());
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY
    );
    expect(mocked.navigate).toHaveBeenCalledWith({ to: "/login" });
  });
});

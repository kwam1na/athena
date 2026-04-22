import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { CashierManagement } from "./CashierManagement";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("~/src/lib/security/pinHash", () => ({
  hashPin: vi.fn(async (pin: string) => `hashed:${pin}`),
}));

vi.mock("../pos/PinInput", () => ({
  PinInput: ({
    disabled,
    onChange,
    value,
  }: {
    disabled: boolean;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <input
      aria-label="Pin input"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const mockedUseMutation = vi.mocked(useMutation);
const mockedUseQuery = vi.mocked(useQuery);

const createStaffProfile = vi.fn();
const updateStaffProfile = vi.fn();
const updateStaffCredential = vi.fn();

const defaultStaffProfiles = [
  {
    _id: "staff-1" as Id<"staffProfile">,
    credentialStatus: "pending" as const,
    firstName: "Ama",
    fullName: "Ama Mensah",
    lastName: "Mensah",
    primaryRole: "cashier" as const,
    roles: ["cashier" as const],
    status: "active" as const,
    username: "amens",
  },
];

function mockConvex({
  staffProfiles = defaultStaffProfiles,
  usernameAvailability = { available: true, normalizedUsername: "amens" },
}: {
  staffProfiles?: typeof defaultStaffProfiles;
  usernameAvailability?: { available: boolean; normalizedUsername: string } | undefined;
} = {}) {
  mockedUseQuery.mockImplementation((...[_reference, args]) => {
    if (args === "skip") {
      return undefined as never;
    }

    if (args && typeof args === "object" && "username" in args) {
      return usernameAvailability as never;
    }

    if (args && typeof args === "object" && "storeId" in args) {
      return staffProfiles;
    }

    return undefined as never;
  });

  mockedUseMutation.mockImplementation(
    () =>
      ((args: Record<string, unknown>) => {
        if ("requestedRoles" in args) {
          return createStaffProfile(args);
        }

        if (args.status === "inactive") {
          return updateStaffProfile(args);
        }

        return updateStaffCredential(args);
      }) as never
  );
}

async function chooseRole(user: ReturnType<typeof userEvent.setup>, role: RegExp) {
  await user.click(screen.getByRole("combobox", { name: /role/i }));
  await user.click(await screen.findByRole("option", { name: role }));
}

describe("CashierManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createStaffProfile.mockResolvedValue({ _id: "staff-2" });
    updateStaffProfile.mockResolvedValue({});
    updateStaffCredential.mockResolvedValue({});
  });

  it("renders pending PIN roster rows with the set PIN action", () => {
    mockConvex();

    render(
      <CashierManagement
        organizationId={"org-1" as Id<"organization">}
        storeId={"store-1" as Id<"store">}
      />
    );

    expect(screen.getByText("Ama Mensah")).toBeInTheDocument();
    expect(screen.getAllByText("Pending PIN")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /set pin/i })).toBeInTheDocument();
  });

  it("provisions staff with username and role before PIN setup", async () => {
    mockConvex({
      staffProfiles: [],
      usernameAvailability: { available: true, normalizedUsername: "amens" },
    });
    const user = userEvent.setup();

    render(
      <CashierManagement
        organizationId={"org-1" as Id<"organization">}
        storeId={"store-1" as Id<"store">}
      />
    );

    await user.click(screen.getByRole("button", { name: /add staff member/i }));
    await user.type(screen.getByLabelText(/first name/i), "Ama");
    await user.type(screen.getByLabelText(/last name/i), "Mensah");
    await chooseRole(user, /cashier/i);

    await waitFor(() =>
      expect(screen.getByLabelText(/username/i)).toHaveValue("amens")
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(createStaffProfile).toHaveBeenCalledTimes(1));
    expect(createStaffProfile).toHaveBeenCalledWith({
      email: undefined,
      firstName: "Ama",
      hiredAt: undefined,
      jobTitle: undefined,
      lastName: "Mensah",
      organizationId: "org-1",
      phoneNumber: undefined,
      requestedRoles: ["cashier"],
      staffCode: undefined,
      storeId: "store-1",
      username: "amens",
    });
    expect(updateStaffCredential).not.toHaveBeenCalled();
  });

  it("sets a PIN for a pending credential", async () => {
    mockConvex();
    const user = userEvent.setup();

    render(
      <CashierManagement
        organizationId={"org-1" as Id<"organization">}
        storeId={"store-1" as Id<"store">}
      />
    );

    await user.click(screen.getByRole("button", { name: /set pin/i }));
    const pinInputs = screen.getAllByLabelText(/pin input/i);
    await user.type(pinInputs[0]!, "123456");
    await user.type(pinInputs[1]!, "123456");
    await user.click(screen.getByRole("button", { name: /save pin/i }));

    await waitFor(() => expect(updateStaffCredential).toHaveBeenCalledTimes(1));
    expect(updateStaffCredential).toHaveBeenCalledWith({
      organizationId: "org-1",
      pinHash: "hashed:123456",
      staffProfileId: "staff-1",
      status: "active",
      storeId: "store-1",
    });
  });
});

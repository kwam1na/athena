import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { StaffManagement } from "./StaffManagement";

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
    email: "ama@example.com",
    firstName: "Ama",
    fullName: "Ama Mensah",
    hiredAt: new Date("2024-01-15T00:00:00.000Z").getTime(),
    jobTitle: "Cashier",
    lastName: "Mensah",
    phoneNumber: "+233200000000",
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
  usernameAvailability?:
    | { available: boolean; normalizedUsername: string }
    | ((args: { storeId: string; username: string }) => {
        available: boolean;
        normalizedUsername: string;
      })
    | undefined;
} = {}) {
  mockedUseQuery.mockImplementation((...[_reference, args]) => {
    if (args === "skip") {
      return undefined as never;
    }

    if (args && typeof args === "object" && "username" in args) {
      if (typeof usernameAvailability === "function") {
        return usernameAvailability({
          storeId: args.storeId as string,
          username: args.username as string,
        }) as never;
      }

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
        if ("staffProfileId" in args && "requestedRoles" in args) {
          return updateStaffProfile(args);
        }

        if ("requestedRoles" in args) {
          return createStaffProfile(args);
        }

        if (args.status === "inactive") {
          return updateStaffProfile(args);
        }

        return updateStaffCredential(args);
      }) as never,
  );
}

async function chooseRole(
  user: ReturnType<typeof userEvent.setup>,
  role: RegExp,
) {
  await user.click(screen.getByRole("combobox", { name: /role/i }));
  await user.click(await screen.findByRole("option", { name: role }));
}

describe("StaffManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createStaffProfile.mockResolvedValue({ _id: "staff-2" });
    updateStaffProfile.mockResolvedValue({});
    updateStaffCredential.mockResolvedValue({});
  });

  it("renders pending PIN roster rows with the set PIN action", () => {
    mockConvex();

    render(
      <StaffManagement
        organizationId={"org-1" as Id<"organization">}
        storeId={"store-1" as Id<"store">}
      />,
    );

    expect(screen.getByText("Ama Mensah")).toBeInTheDocument();
    expect(screen.getAllByText("Pending PIN")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /set pin/i }),
    ).toBeInTheDocument();
  });

  it("provisions staff with username and role before PIN setup", async () => {
    mockConvex({
      staffProfiles: [],
      usernameAvailability: { available: true, normalizedUsername: "amens" },
    });
    const user = userEvent.setup();

    render(
      <StaffManagement
        organizationId={"org-1" as Id<"organization">}
        storeId={"store-1" as Id<"store">}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add staff member/i }));
    await user.type(screen.getByLabelText(/first name/i), "Ama");
    await user.type(screen.getByLabelText(/last name/i), "Mensah");
    await chooseRole(user, /cashier/i);

    await waitFor(() =>
      expect(screen.getByLabelText(/username/i)).toHaveValue("amens"),
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
      <StaffManagement
        organizationId={"org-1" as Id<"organization">}
        storeId={"store-1" as Id<"store">}
      />,
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

  it("edits an existing staff profile from the roster", async () => {
    mockConvex({
      usernameAvailability: ({ username }) => ({
        available: true,
        normalizedUsername: username,
      }),
    });
    const user = userEvent.setup();

    render(
      <StaffManagement
        organizationId={"org-1" as Id<"organization">}
        storeId={"store-1" as Id<"store">}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit/i }));

    const firstNameInput = screen.getByLabelText(/first name/i);
    await user.clear(firstNameInput);
    await user.type(firstNameInput, "Kojo");

    const lastNameInput = screen.getByLabelText(/last name/i);
    await user.clear(lastNameInput);
    await user.type(lastNameInput, "Badu");

    const usernameInput = screen.getByLabelText(/username/i);
    expect(usernameInput).toHaveAttribute("readonly");
    await waitFor(() => expect(usernameInput).toHaveValue("kbadu"));

    const emailInput = screen.getByLabelText(/email/i);
    await user.clear(emailInput);
    await user.type(emailInput, "afi@example.com");

    await chooseRole(user, /manager/i);
    await user.click(screen.getByRole("button", { name: /update/i }));

    await waitFor(() => expect(updateStaffProfile).toHaveBeenCalledTimes(1));
    expect(updateStaffProfile).toHaveBeenCalledWith({
      email: "afi@example.com",
      firstName: "Kojo",
      hiredAt: new Date("2024-01-15T00:00:00").getTime(),
      jobTitle: "Cashier",
      lastName: "Badu",
      organizationId: "org-1",
      phoneNumber: "+233200000000",
      requestedRoles: ["manager"],
      staffCode: undefined,
      staffProfileId: "staff-1",
      storeId: "store-1",
      username: "kbadu",
    });
  });

  it("derives the next available username while editing when the first candidate is taken", async () => {
    mockConvex({
      usernameAvailability: ({ username }) => ({
        available: username !== "kbadu",
        normalizedUsername: username,
      }),
    });
    const user = userEvent.setup();

    render(
      <StaffManagement
        organizationId={"org-1" as Id<"organization">}
        storeId={"store-1" as Id<"store">}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const firstNameInput = screen.getByLabelText(/first name/i);
    await user.clear(firstNameInput);
    await user.type(firstNameInput, "Kojo");

    const lastNameInput = screen.getByLabelText(/last name/i);
    await user.clear(lastNameInput);
    await user.type(lastNameInput, "Badu");

    await waitFor(() =>
      expect(screen.getByLabelText(/username/i)).toHaveValue("kbad2"),
    );
  });
});

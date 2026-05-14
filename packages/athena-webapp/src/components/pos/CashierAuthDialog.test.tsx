import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Id } from "~/convex/_generated/dataModel";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  ok,
  userError,
} from "~/shared/commandResult";
import { mapThrownError } from "~/src/lib/pos/application/results";

import { CashierAuthDialog } from "./CashierAuthDialog";

const mocks = vi.hoisted(() => ({
  hashPin: vi.fn(async (pin: string) => `hashed:${pin}`),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mocks.useMutation,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("~/src/lib/security/pinHash", () => ({
  hashPin: mocks.hashPin,
}));

vi.mock("@/components/pos/PinInput", () => ({
  PinInput: ({
    disabled,
    onChange,
    onKeyDown,
    value,
  }: {
    disabled: boolean;
    onChange: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent) => void;
    value: string;
  }) => (
    <input
      aria-label="PIN"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  ),
}));

vi.mock("../ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;
const staffProfileId = "staff-1" as Id<"staffProfile">;

function renderDialog({
  authenticateMutation = vi.fn(),
  expireMutation = vi.fn(),
  workflowMode,
}: {
  authenticateMutation?: ReturnType<typeof vi.fn>;
  expireMutation?: ReturnType<typeof vi.fn>;
  workflowMode?: "pos" | "expense";
} = {}) {
  mocks.useMutation.mockReset();
  let mutationCallCount = 0;
  mocks.useMutation.mockImplementation(() => {
    mutationCallCount += 1;

    return (
      mutationCallCount % 2 === 1 ? authenticateMutation : expireMutation
    ) as never;
  });

  const onAuthenticated = vi.fn();
  const onDismiss = vi.fn();

  render(
    <CashierAuthDialog
      open
      onAuthenticated={onAuthenticated}
      onDismiss={onDismiss}
      storeId={storeId}
      terminalId={terminalId}
      workflowMode={workflowMode}
    />,
  );

  return {
    authenticateMutation,
    expireMutation,
    onAuthenticated,
    onDismiss,
    user: userEvent.setup(),
  };
}

async function submitCredentials(
  user: ReturnType<typeof userEvent.setup>,
  {
    pin = "123456",
    username = "frontdesk",
  }: {
    pin?: string;
    username?: string;
  } = {},
) {
  await waitFor(() => expect(screen.getByLabelText(/username/i)).toHaveFocus());
  await user.type(screen.getByLabelText(/username/i), username);
  await user.type(screen.getByLabelText(/pin/i), pin);
}

describe("CashierAuthDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows safe authentication failure copy for invalid credentials", async () => {
    const authenticateMutation = vi.fn().mockResolvedValue(
      userError({
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      }),
    );

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Sign-in details not recognized. Enter the username and PIN again.",
      ),
    );
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("[CONVEX]"),
    );
  });

  it("shows safe precondition copy when another terminal is active", async () => {
    const authenticateMutation = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message: "This staff member has an active session on another terminal.",
      }),
    );

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Sign-in already active on another terminal. Sign out there before starting here.",
      ),
    );
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("uses expense session copy when signing into expense mode", () => {
    const authenticateMutation = vi.fn();

    renderDialog({ authenticateMutation, workflowMode: "expense" });

    expect(
      screen.getByRole("heading", { name: "Sign in required" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out from other sessions" }),
    ).toBeInTheDocument();
  });

  it("collapses thrown faults to generic fallback copy and clears the PIN", async () => {
    const authenticateMutation = vi
      .fn()
      .mockRejectedValue(
        new Error("[CONVEX] raw backend details that should never be toasted"),
      );

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        GENERIC_UNEXPECTED_ERROR_MESSAGE,
      ),
    );
    await waitFor(() => expect(screen.getByLabelText(/pin/i)).toHaveValue(""));
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("raw backend details"),
    );
  });

  it("still completes a successful cashier sign-in", async () => {
    const authenticateMutation = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["cashier"],
        credentialId: "credential-1",
        staffProfile: {
          firstName: "Ama",
          fullName: "Ama Mensah",
          lastName: "Mensah",
        },
        staffProfileId,
      }),
    );

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Signed in as Ama Mensah",
      ),
    );
    expect(onAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ staffProfileId }),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("authenticates before signing out from other registers", async () => {
    const authenticateMutation = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        credentialId: "credential-1",
        staffProfile: {
          firstName: "Ama",
          fullName: "Ama Mensah",
          lastName: "Mensah",
        },
        staffProfileId,
      }),
    );
    const expireMutation = vi.fn().mockResolvedValue({ success: true });

    const { user, onAuthenticated } = renderDialog({
      authenticateMutation,
      expireMutation,
    });

    await user.click(
      screen.getByRole("button", { name: "Sign out from other registers" }),
    );
    expect(
      screen.getByRole("heading", { name: "Sign out from other registers" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Return to sign in" }),
    ).toBeInTheDocument();

    await submitCredentials(user);
    await user.click(
      screen.getByRole("button", { name: "Sign out from all registers" }),
    );

    await waitFor(() =>
      expect(authenticateMutation).toHaveBeenNthCalledWith(1, {
        allowedRoles: ["cashier", "manager"],
        allowActiveSessionsOnOtherTerminals: true,
        pinHash: "hashed:123456",
        storeId,
        terminalId,
        username: "frontdesk",
      }),
    );
    await waitFor(() =>
      expect(expireMutation).toHaveBeenCalledWith({
        staffProfileId,
        terminalId,
      }),
    );
    await waitFor(() =>
      expect(authenticateMutation).toHaveBeenNthCalledWith(2, {
        allowedRoles: ["cashier", "manager"],
        pinHash: "hashed:123456",
        storeId,
        terminalId,
        username: "frontdesk",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Signed out from all registers",
    );
    expect(onAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ staffProfileId }),
    );
  });
});

describe("mapThrownError", () => {
  it("uses the shared generic fallback copy for thrown faults", () => {
    expect(mapThrownError(new Error("database exploded"))).toEqual({
      ok: false,
      code: "unknown",
      message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
    });
  });

  it("preserves known drawer conflict messages from wrapped Convex faults", () => {
    expect(
      mapThrownError(
        new Error(
          "Uncaught Error: A register session is already open for this register number",
        ),
      ),
    ).toEqual({
      ok: false,
      code: "conflict",
      message: "A register session is already open for this register number",
    });
  });
});

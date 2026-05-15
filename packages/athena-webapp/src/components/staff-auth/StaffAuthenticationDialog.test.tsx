import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StaffAuthenticationDialog } from "./StaffAuthenticationDialog";

vi.mock("@/components/pos/PinInput", () => ({
  PinInput: ({
    disabled,
    maxLength,
    onChange,
    value,
  }: {
    disabled?: boolean;
    maxLength: number;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <input
      aria-label="PIN"
      disabled={disabled}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
      value={value}
    />
  ),
}));

vi.mock("@/lib/security/pinHash", () => ({
  hashPin: vi.fn(async (pin: string) => `hashed:${pin}`),
}));

const baseProps = {
  copy: {
    description: "Authenticate to continue.",
    submitLabel: "Continue",
    title: "Confirm staff credentials",
  },
  onAuthenticate: vi.fn(),
  onAuthenticated: vi.fn(),
  onDismiss: vi.fn(),
  open: true,
};

describe("StaffAuthenticationDialog", () => {
  beforeEach(() => {
    baseProps.onAuthenticate.mockReset();
    baseProps.onAuthenticated.mockReset();
    baseProps.onDismiss.mockReset();
  });

  it("renders inline presentation without requiring a Dialog provider", () => {
    render(<StaffAuthenticationDialog {...baseProps} presentation="inline" />);

    expect(
      screen.getByRole("heading", { name: "Confirm staff credentials" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Authenticate to continue.")).toBeInTheDocument();
  });

  it("renders embedded presentation without requiring a Dialog provider", () => {
    render(
      <StaffAuthenticationDialog {...baseProps} presentation="embedded" />,
    );

    expect(
      screen.getByRole("heading", { name: "Confirm staff credentials" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Authenticate to continue.")).toBeInTheDocument();
  });

  it("does not submit again while an authentication request is already in flight", async () => {
    const onAuthenticate = vi.fn(
      () =>
        new Promise<never>(() => {
          // Keep the request pending so a parent re-render can exercise the guard.
        }),
    );

    const { rerender } = render(
      <StaffAuthenticationDialog
        {...baseProps}
        onAuthenticate={onAuthenticate}
        onAuthenticated={vi.fn()}
        presentation="inline"
      />,
    );

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "frontdesk" },
    });
    fireEvent.change(screen.getByLabelText(/pin/i), {
      target: { value: "1234" },
    });

    await waitFor(() => expect(onAuthenticate).toHaveBeenCalledTimes(1));

    rerender(
      <StaffAuthenticationDialog
        {...baseProps}
        onAuthenticate={onAuthenticate}
        onAuthenticated={vi.fn()}
        presentation="inline"
      />,
    );

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(onAuthenticate).toHaveBeenCalledTimes(1);
  });

  it("submits staff credentials when a four-digit PIN is entered", async () => {
    const onAuthenticate = vi.fn().mockResolvedValue({
      data: {
        staffProfile: { fullName: "Front Desk" },
        staffProfileId: "staff-profile-id",
      },
      kind: "ok",
    });
    const onAuthenticated = vi.fn();

    render(
      <StaffAuthenticationDialog
        {...baseProps}
        onAuthenticate={onAuthenticate}
        onAuthenticated={onAuthenticated}
        presentation="inline"
      />,
    );

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: " frontdesk " },
    });
    fireEvent.change(screen.getByLabelText(/pin/i), {
      target: { value: "1234" },
    });

    await waitFor(() =>
      expect(onAuthenticate).toHaveBeenCalledWith({
        mode: "authenticate",
        pin: "1234",
        pinHash: "hashed:1234",
        username: "frontdesk",
      }),
    );
    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith(
        {
          staffProfile: { fullName: "Front Desk" },
          staffProfileId: "staff-profile-id",
        },
        "authenticate",
        { pinHash: "hashed:1234", username: "frontdesk" },
      ),
    );
  });

  it("does not submit an incomplete staff PIN", async () => {
    const user = userEvent.setup();
    const onAuthenticate = vi.fn();

    render(
      <StaffAuthenticationDialog
        {...baseProps}
        onAuthenticate={onAuthenticate}
        onAuthenticated={vi.fn()}
        presentation="inline"
      />,
    );

    await user.type(screen.getByLabelText(/username/i), "frontdesk");
    await user.type(screen.getByLabelText(/pin/i), "123");

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(onAuthenticate).not.toHaveBeenCalled();
  });

  it("sanitizes pasted mixed staff PIN input before authenticating", async () => {
    const onAuthenticate = vi.fn().mockResolvedValue({
      data: {
        staffProfile: { fullName: "Front Desk" },
        staffProfileId: "staff-profile-id",
      },
      kind: "ok",
    });

    render(
      <StaffAuthenticationDialog
        {...baseProps}
        onAuthenticate={onAuthenticate}
        onAuthenticated={vi.fn()}
        presentation="inline"
      />,
    );

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "frontdesk" },
    });
    fireEvent.change(screen.getByLabelText(/pin/i), {
      target: { value: "12 a3-4z9" },
    });

    await waitFor(() =>
      expect(onAuthenticate).toHaveBeenCalledWith({
        mode: "authenticate",
        pin: "1234",
        pinHash: "hashed:1234",
        username: "frontdesk",
      }),
    );
  });
});

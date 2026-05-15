import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StaffAuthenticationDialog } from "./StaffAuthenticationDialog";

vi.mock("@/components/pos/PinInput", () => ({
  PinInput: ({
    disabled,
    onChange,
    value,
  }: {
    disabled?: boolean;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <input
      aria-label="PIN"
      disabled={disabled}
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
      target: { value: "123456" },
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
});

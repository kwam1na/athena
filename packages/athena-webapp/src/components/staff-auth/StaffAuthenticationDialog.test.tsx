import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StaffAuthenticationDialog } from "./StaffAuthenticationDialog";

vi.mock("@/components/pos/PinInput", () => ({
  PinInput: ({ value }: { value: string }) => (
    <input aria-label="PIN" readOnly value={value} />
  ),
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
});

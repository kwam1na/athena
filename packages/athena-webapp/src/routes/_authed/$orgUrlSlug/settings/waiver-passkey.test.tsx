import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: false, isLoading: false },
  beginRegistration: vi.fn(),
  completeRegistration: vi.fn(),
  authorizeRegistration: vi.fn(),
  startRegistration: vi.fn(),
}));

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: (...args: unknown[]) => mocks.startRegistration(...args),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));
vi.mock("convex/react", () => ({
  useAction: (reference: string) =>
    reference.includes("beginRegistration")
      ? mocks.beginRegistration
      : mocks.completeRegistration,
  useConvexAuth: () => mocks.auth,
  useMutation: () => mocks.authorizeRegistration,
}));
vi.mock("~/convex/_generated/api", () => ({
  api: {
    harnessWaiver: {
      registrationAuthorization: { authorizeRegistration: "authorizeRegistration" },
      passkeys: {
        beginRegistration: "beginRegistration",
        completeRegistration: "completeRegistration",
      },
    },
  },
}));
vi.mock("@/components/View", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

import { WaiverPasskeySettings } from "./waiver-passkey";

describe("WaiverPasskeySettings authentication gate", () => {
  beforeEach(() => {
    mocks.auth.isAuthenticated = false;
    mocks.auth.isLoading = false;
    mocks.beginRegistration.mockReset();
    mocks.completeRegistration.mockReset();
    mocks.authorizeRegistration.mockReset();
    mocks.startRegistration.mockReset();
  });

  it("does not expose or invoke enrollment while Convex is unauthenticated", () => {
    render(<WaiverPasskeySettings />);

    expect(screen.queryByRole("button", { name: "Enroll iPhone passkey" })).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(mocks.beginRegistration).not.toHaveBeenCalled();
  });

  it("waits for Convex authentication before exposing enrollment", () => {
    mocks.auth.isLoading = true;
    const { rerender } = render(<WaiverPasskeySettings />);
    expect(screen.queryByRole("button", { name: "Enroll iPhone passkey" })).toBeNull();

    mocks.auth.isLoading = false;
    mocks.auth.isAuthenticated = true;
    rerender(<WaiverPasskeySettings />);
    fireEvent.change(screen.getByLabelText("One-time enrollment secret"), {
      target: { value: "secret" },
    });

    expect(screen.getByRole("button", { name: "Enroll iPhone passkey" })).toBeEnabled();
    expect(mocks.beginRegistration).not.toHaveBeenCalled();
  });

  it("authorizes through the authenticated mutation before starting WebAuthn", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.authorizeRegistration.mockResolvedValue(null);
    mocks.beginRegistration.mockResolvedValue({ challenge: "challenge" });
    mocks.startRegistration.mockResolvedValue({ id: "credential" });
    mocks.completeRegistration.mockResolvedValue({ enrolled: true });
    render(<WaiverPasskeySettings />);
    fireEvent.change(screen.getByLabelText("One-time enrollment secret"), {
      target: { value: "secret" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enroll iPhone passkey" }));
      await vi.waitFor(() => expect(mocks.completeRegistration).toHaveBeenCalledTimes(1));
    });

    expect(mocks.authorizeRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.beginRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.authorizeRegistration.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.beginRegistration.mock.invocationCallOrder[0],
    );
    expect(await screen.findByText("Passkey enrolled.")).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { presentCommandToast } from "./presentCommandToast";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
  },
}));

describe("presentCommandToast", () => {
  beforeEach(() => {
    mocks.toastError.mockClear();
  });

  it("normalizes known user error copy for operators", () => {
    presentCommandToast({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      },
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Sign-in details not recognized. Enter the username and PIN again.",
    );
  });

  it("passes through user error copy that already matches the guide", () => {
    presentCommandToast({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Barcode not found. Scan again or search by name.",
      },
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Barcode not found. Scan again or search by name.",
    );
  });

  it("shows a generic fallback for unexpected errors", () => {
    presentCommandToast({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: "Please try again.",
      },
    });

    expect(mocks.toastError).toHaveBeenCalledWith("Please try again.");
  });

  it("shows approval guidance instead of generic failure copy", () => {
    presentCommandToast({
      kind: "approval_required",
      approval: {
        action: {
          key: "transaction.payment_method_correction",
          label: "Update payment method",
        },
        copy: {
          title: "Approval unavailable",
          message:
            "This correction cannot be approved here. Use refund or exchange instead.",
        },
        reason: "Multi-payment corrections are not supported.",
        requiredRole: "manager",
        resolutionModes: [],
        subject: {
          id: "transaction-1",
          type: "transaction",
        },
      },
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "This correction cannot be approved here. Use refund or exchange instead.",
    );
    expect(mocks.toastError).not.toHaveBeenCalledWith("Please try again.");
  });
});

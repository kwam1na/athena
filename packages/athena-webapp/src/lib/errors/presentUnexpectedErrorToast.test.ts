import { beforeEach, describe, expect, it, vi } from "vitest";

import { GENERIC_UNEXPECTED_ERROR_MESSAGE } from "~/shared/commandResult";

import { presentUnexpectedErrorToast } from "./presentUnexpectedErrorToast";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
  },
}));

describe("presentUnexpectedErrorToast", () => {
  beforeEach(() => {
    mocks.toastError.mockReset();
  });

  it("shows the shared fallback description for unexpected errors", () => {
    presentUnexpectedErrorToast("Failed to delete promo code");

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to delete promo code",
      {
        description: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      },
    );
  });

  it("preserves non-description toast options", () => {
    presentUnexpectedErrorToast("Something went wrong", {
      position: "top-right",
    });

    expect(mocks.toastError).toHaveBeenCalledWith("Something went wrong", {
      description: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      position: "top-right",
    });
  });
});

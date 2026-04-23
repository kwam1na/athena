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

  it("shows trusted user error copy", () => {
    presentCommandToast({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Your session has expired",
      },
    });

    expect(mocks.toastError).toHaveBeenCalledWith("Your session has expired");
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
});

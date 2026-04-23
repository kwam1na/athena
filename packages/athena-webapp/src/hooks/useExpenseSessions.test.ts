import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation } from "convex/react";

import { useExpenseSessionCreate } from "./useExpenseSessions";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const mockedUseMutation = vi.mocked(useMutation);
const createExpenseSessionMutation = vi.fn();

describe("useExpenseSessionCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseMutation.mockReturnValue(createExpenseSessionMutation as never);
  });

  it("throws the safe user_error message returned by the command result", async () => {
    createExpenseSessionMutation.mockResolvedValue({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Terminal details missing",
      },
    });

    const { result } = renderHook(() => useExpenseSessionCreate());

    await expect(
      result.current.createSession(
        "store-1" as never,
        "terminal-1" as never,
        "staff-1" as never,
      ),
    ).rejects.toThrow("Terminal details missing");
  });

  it("collapses unexpected failures to the shared generic fallback message", async () => {
    createExpenseSessionMutation.mockRejectedValue(new Error("database offline"));

    const { result } = renderHook(() => useExpenseSessionCreate());

    await expect(
      result.current.createSession(
        "store-1" as never,
        "terminal-1" as never,
        "staff-1" as never,
      ),
    ).rejects.toThrow("Please try again.");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("./infrastructure/telemetry/loggerGateway", () => ({
  reportPosHandledException: mocks.report,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { handlePOSOperation } from "./toastService";

describe("handlePOSOperation telemetry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports a thrown exceptional operation once", async () => {
    const error = new Error("provider exploded");
    await handlePOSOperation(async () => {
      throw error;
    });
    expect(mocks.report).toHaveBeenCalledWith({
      error,
      flow: "runtime",
      localMessage: "[POS] Operation exception",
      operation: "handlePosOperation",
    });
  });

  it("keeps an ordinary failed result quiet, including the rethrow option", async () => {
    await expect(
      handlePOSOperation(
        async () => ({ success: false as const, message: "validation failed" }),
        { rethrowErrors: true },
      ),
    ).rejects.toThrow("validation failed");
    expect(mocks.report).not.toHaveBeenCalled();
  });
});

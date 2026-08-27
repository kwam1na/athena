import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: mocks.error,
    warn: mocks.warn,
  },
}));
vi.mock("./telemetryBuffer", () => ({ enqueuePosClientEvent: mocks.enqueue }));

import { loggerGateway, reportPosHandledException } from "./loggerGateway";

describe("reportPosHandledException", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits one finite unexpected event while keeping raw text console-only", () => {
    const error = new Error("customer-secret receipt-secret");
    reportPosHandledException({
      error,
      flow: "printing",
      localMessage: "Print failed",
      operation: "printReceipt",
    });
    expect(mocks.error).toHaveBeenCalledWith("Print failed", error);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      classification: "unexpected_application_error",
      error,
      flow: "printing",
      level: "error",
      operation: "printReceipt",
    });
    expect(JSON.stringify(mocks.enqueue.mock.calls[0]?.[0])).not.toContain(
      "customer-secret",
    );
  });

  it("keeps coded expected outcomes and ordinary logger calls off the remote rail", () => {
    reportPosHandledException({
      error: { code: "authorization_failed" },
      flow: "settings",
      localMessage: "Denied",
      operation: "registerTerminal",
    });
    loggerGateway.error("ordinary result", { error: "validation" });
    loggerGateway.warn("ordinary warning", { offline: true });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

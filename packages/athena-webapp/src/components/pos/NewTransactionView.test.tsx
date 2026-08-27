import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), report: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { slug: "osu" } }),
}));
vi.mock("@/hooks/useGetOrganizations", () => ({
  useGetActiveOrganization: () => ({ activeOrganization: { slug: "acme" } }),
}));
vi.mock("@/lib/pos/infrastructure/telemetry/loggerGateway", () => ({
  reportPosHandledException: mocks.report,
}));
vi.mock("../View", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../common/FadeIn", () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { NewTransactionView } from "./NewTransactionView";

describe("NewTransactionView telemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("reports an unexpected transaction-start navigation failure once", async () => {
    const error = new Error("customer-secret");
    mocks.navigate.mockImplementation(() => {
      throw error;
    });
    render(<NewTransactionView />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /Start Transaction with Customer Info/i,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mocks.report).toHaveBeenCalledWith({
      error,
      flow: "transaction",
      localMessage: "Failed to start transaction",
      operation: "startTransaction",
    });
  });
});

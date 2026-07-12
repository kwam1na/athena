import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  request: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useAction: () => mocks.getStatus,
  useMutation: () => mocks.request,
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1" } }),
}));
vi.mock("~/convex/_generated/api", () => ({
  api: {
    reporting: {
      customRangeRequests: {
        getCustomRangeStatus: "status",
        requestCustomRange: "request",
      },
    },
  },
}));

import { ReportsWorkspaceControls } from "./ReportsWorkspaceControls";

describe("ReportsWorkspaceControls", () => {
  beforeEach(() => {
    mocks.getStatus.mockReset();
    mocks.request.mockReset();
  });

  it("requests a custom range and carries the run into addressable search", async () => {
    mocks.request.mockResolvedValue({ runId: "run-1", status: "created" });
    const onSearchChange = vi.fn();
    render(
      <ReportsWorkspaceControls
        onSearchChange={onSearchChange}
        search={{ end: "2026-07-11", preset: "custom", start: "2026-07-01" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Build report" }));
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith({
        endOperatingDate: "2026-07-11",
        startOperatingDate: "2026-07-01",
        storeId: "store-1",
      }),
    );
    expect(onSearchChange).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "custom", runId: "run-1" }),
    );
  });

  it("reads an existing run and presents verified completion", async () => {
    mocks.getStatus.mockResolvedValue({
      failedCount: 0,
      processedCount: 12,
      status: "completed",
    });
    render(
      <ReportsWorkspaceControls
        onSearchChange={vi.fn()}
        search={{
          end: "2026-07-11",
          preset: "custom",
          runId: "run-1",
          start: "2026-07-01",
        }}
      />,
    );
    expect(await screen.findByText("Custom report ready")).toBeInTheDocument();
    expect(mocks.getStatus).toHaveBeenCalledWith({
      runId: "run-1",
      storeId: "store-1",
    });
  });
});

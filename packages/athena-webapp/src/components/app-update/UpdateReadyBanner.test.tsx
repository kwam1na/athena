import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UpdateCoordinatorProvider, useUpdateCoordinator } from "@/lib/app-update";
import { UpdateReadyBanner } from "./UpdateReadyBanner";

function Probe({
  blocked = false,
  onReady,
}: {
  blocked?: boolean;
  onReady?: () => void;
}) {
  const { reportUpdateDetected, registerApplyBlocker } = useUpdateCoordinator();

  return (
    <button
      type="button"
      onClick={() => {
        reportUpdateDetected({
          currentBuildId: "build-1",
          pendingBuildId: "build-2",
          stagingStatus: "staged",
        });
        if (blocked) {
          registerApplyBlocker({
            surfaceId: "pos-register",
            priority: "critical-workflow",
            label: "Register sale",
            guidance: "Finish this sale before refreshing.",
          });
        }
        onReady?.();
      }}
    >
      mark ready
    </button>
  );
}

describe("UpdateReadyBanner", () => {
  it("renders no banner while the app is current", () => {
    render(
      <UpdateCoordinatorProvider reload={vi.fn()}>
        <UpdateReadyBanner />
      </UpdateCoordinatorProvider>,
    );

    expect(screen.queryByLabelText("Update ready")).not.toBeInTheDocument();
  });

  it("renders an apply action and reloads once when no blocker exists", () => {
    const reload = vi.fn();
    render(
      <UpdateCoordinatorProvider reload={reload}>
        <Probe />
        <UpdateReadyBanner />
      </UpdateCoordinatorProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "mark ready" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByLabelText("Update ready")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows blocker guidance without an apply action while work is unsafe", () => {
    render(
      <UpdateCoordinatorProvider reload={vi.fn()}>
        <Probe blocked />
        <UpdateReadyBanner />
      </UpdateCoordinatorProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "mark ready" }));

    expect(
      screen.getByText("Finish this sale before refreshing."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });
});

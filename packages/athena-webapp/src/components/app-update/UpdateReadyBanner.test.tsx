import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  UpdateCommunicationPreferenceProvider,
  UpdateCoordinatorProvider,
  useUpdateCoordinator,
  useUpdateCommunicationPreference,
} from "@/lib/app-update";
import { UpdateReadyBanner } from "./UpdateReadyBanner";

const toastMock = vi.hoisted(() => ({
  show: vi.fn(),
  message: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastMock.show, {
    message: toastMock.message,
    custom: toastMock.custom,
    dismiss: toastMock.dismiss,
  }),
}));

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

function ToastPreferenceProbe() {
  useUpdateCommunicationPreference({
    surfaceId: "pos-register",
    variant: "toast",
  });

  return null;
}

function renderWithUpdateProviders(
  children: ReactNode,
  { reload = vi.fn() }: { reload?: () => void } = {},
) {
  return render(
    <UpdateCoordinatorProvider reload={reload}>
      <UpdateCommunicationPreferenceProvider>
        {children}
      </UpdateCommunicationPreferenceProvider>
    </UpdateCoordinatorProvider>,
  );
}

describe("UpdateReadyBanner", () => {
  beforeEach(() => {
    toastMock.show.mockReset();
    toastMock.message.mockReset();
    toastMock.custom.mockReset();
    toastMock.dismiss.mockReset();
  });

  it("renders no banner while the app is current", () => {
    renderWithUpdateProviders(<UpdateReadyBanner />);

    expect(screen.queryByLabelText("Update ready")).not.toBeInTheDocument();
  });

  it("does not show the toast variant while the app is current", () => {
    renderWithUpdateProviders(
      <>
        <ToastPreferenceProbe />
        <UpdateReadyBanner />
      </>,
    );

    expect(screen.queryByLabelText("Update ready")).not.toBeInTheDocument();
    expect(toastMock.message).not.toHaveBeenCalled();
  });

  it("renders the banner by default and reloads once when no blocker exists", () => {
    const reload = vi.fn();
    renderWithUpdateProviders(
      <>
        <Probe />
        <UpdateReadyBanner />
      </>,
      { reload },
    );

    fireEvent.click(screen.getByRole("button", { name: "mark ready" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByLabelText("Update ready")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toastMock.message).not.toHaveBeenCalled();
  });

  it("uses a persistent top-right toast instead of the banner when a surface opts in", () => {
    renderWithUpdateProviders(
      <>
        <ToastPreferenceProbe />
        <Probe />
        <UpdateReadyBanner />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "mark ready" }));

    expect(screen.queryByLabelText("Update ready")).not.toBeInTheDocument();
    expect(toastMock.message).toHaveBeenCalledWith(
      "Update ready",
      expect.objectContaining({
        action: expect.any(Object),
        className: "min-w-80",
        classNames: expect.objectContaining({
          content: "min-w-0 flex-1",
          toast: "justify-between",
        }),
        closeButton: false,
        dismissible: false,
        duration: Number.POSITIVE_INFINITY,
        id: "athena-update-ready-toast",
        position: "top-right",
      }),
    );
  });

  it("shows blocker guidance without an apply action while work is unsafe", () => {
    renderWithUpdateProviders(
      <>
        <Probe blocked />
        <UpdateReadyBanner />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "mark ready" }));

    expect(
      screen.getByText("Finish this sale before refreshing."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
  });
});

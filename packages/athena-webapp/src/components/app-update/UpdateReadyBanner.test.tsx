import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  stagingReason,
  stagingStatus = "staged",
}: {
  blocked?: boolean;
  onReady?: () => void;
  stagingReason?: "asset-staging-failed";
  stagingStatus?: "staged" | "unstaged";
}) {
  const { reportUpdateDetected, registerApplyBlocker } = useUpdateCoordinator();

  return (
    <button
      type="button"
      onClick={() => {
        reportUpdateDetected({
          currentBuildId: "build-1",
          pendingBuildId: "build-2",
          ...(stagingReason ? { stagingReason } : {}),
          stagingStatus,
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

function CommunicationPreferenceProbe({
  variant,
}: {
  variant: "ghost" | "banner" | "toast";
}) {
  useUpdateCommunicationPreference({
    surfaceId: "pos-register",
    variant,
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
    vi.stubGlobal("BroadcastChannel", undefined);
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
        <CommunicationPreferenceProbe variant="toast" />
        <UpdateReadyBanner />
      </>,
    );

    expect(screen.queryByLabelText("Update ready")).not.toBeInTheDocument();
    expect(toastMock.message).not.toHaveBeenCalled();
  });

  it("renders the bottom-left ghost button by default and reloads once when no blocker exists", () => {
    const reload = vi.fn();
    renderWithUpdateProviders(
      <>
        <Probe />
        <UpdateReadyBanner />
      </>,
      { reload },
    );

    fireEvent.click(screen.getByRole("button", { name: "mark ready" }));
    const applyingButton = screen.getByRole("button", {
      name: "New Athena version available",
    });
    fireEvent.click(applyingButton);
    fireEvent.click(applyingButton);

    expect(screen.getByLabelText("Update ready")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toastMock.message).not.toHaveBeenCalled();
  });

  it("uses a persistent top-right toast instead of the banner when a surface opts in", () => {
    renderWithUpdateProviders(
      <>
        <CommunicationPreferenceProbe variant="toast" />
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

  it("renders the top banner when a surface opts in to the banner variant", () => {
    const reload = vi.fn();
    renderWithUpdateProviders(
      <>
        <CommunicationPreferenceProbe variant="banner" />
        <Probe />
        <UpdateReadyBanner />
      </>,
      { reload },
    );

    fireEvent.click(screen.getByRole("button", { name: "mark ready" }));

    expect(screen.getByLabelText("Update ready")).toHaveClass("top-0");
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows blocker guidance without an apply action while work is unsafe", () => {
    renderWithUpdateProviders(
      <>
        <Probe blocked />
        <UpdateReadyBanner />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "mark ready" }));

    const updateButton = screen.getByRole("button", {
      name: "Finish this sale before refreshing.",
    });
    expect(updateButton).toBeDisabled();
    expect(updateButton).toHaveTextContent("Finish this sale before refreshing.");
    expect(updateButton).toHaveAttribute(
      "title",
      "Finish this sale before refreshing.",
    );
  });

  it("warns about incomplete staging in the banner variant while allowing a manual refresh", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    renderWithUpdateProviders(
      <>
        <CommunicationPreferenceProbe variant="banner" />
        <Probe stagingReason="asset-staging-failed" stagingStatus="unstaged" />
        <UpdateReadyBanner />
      </>,
      { reload },
    );

    fireEvent.click(screen.getByRole("button", { name: "mark ready" }));

    expect(screen.getByText("Update ready")).toBeInTheDocument();
    expect(
      screen.queryByText("Some files were not cached for offline use."),
    ).not.toBeInTheDocument();
    const detailsTrigger = screen.getByRole("button", {
      name: "Update cache details",
    });
    expect(detailsTrigger).toBeInTheDocument();
    await user.hover(detailsTrigger);
    const tooltipContent = (
      await screen.findAllByText("Some files were not cached for offline use.")
    ).find((element) => element.classList.contains("w-72"));
    expect(tooltipContent).toHaveClass(
      "w-72",
      "whitespace-normal",
      "text-left",
    );
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

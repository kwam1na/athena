import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteAssistLiveViewer } from "./RemoteAssistLiveViewer";
import type {
  RemoteAssistCoBrowseFrame,
  RemoteAssistControlResult,
  RemoteAssistSanitizedSurfaceControl,
} from "@/lib/remote-assist";

describe("RemoteAssistLiveViewer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows pending feedback immediately after a support action", () => {
    const onControl = vi.fn();
    render(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame()}
        onControl={onControl}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open drawer/ }));

    expect(screen.getByText("Sending action to runtime...")).toBeTruthy();
    expect(screen.getByText("sending")).toBeTruthy();
    expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Support selected Open drawer",
        target: "athena_surface",
      }),
    );
  });

  it("updates action feedback when the runtime accepts the matching result", () => {
    const onControl = vi.fn();
    const { rerender } = render(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame()}
        onControl={onControl}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open drawer/ }));
    const idempotencyKey = onControl.mock.calls[0][0].idempotencyKey;
    const result: RemoteAssistControlResult = {
      accepted: true,
      event: onControl.mock.calls[0][0].event,
      idempotencyKey,
      sessionId: "session-1",
    };

    rerender(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame()}
        latestControlResult={result}
        onControl={onControl}
      />,
    );

    expect(screen.getByText("Action accepted by runtime.")).toBeTruthy();
    expect(screen.getByText("accepted")).toBeTruthy();
    const acceptedControl = screen.getByRole("button", { name: /Open drawer/ });
    expect(acceptedControl).toHaveClass("border-success/25");
    expect(acceptedControl).toHaveClass("bg-surface-raised");
    expect(acceptedControl).not.toHaveClass("bg-emerald-50");
    expect(acceptedControl).not.toHaveClass("text-emerald-950");
  });

  it("marks pending actions when the runtime does not respond", async () => {
    vi.useFakeTimers();
    const onControl = vi.fn();
    render(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame()}
        onControl={onControl}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open drawer/ }));

    expect(screen.getByText("Sending action to runtime...")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });

    expect(
      screen.getByText(
        "No runtime response after 8 seconds. Reconnect or try again.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("no response")).toBeTruthy();
  });

  it("shows controls for the selected surface tab", async () => {
    const onControl = vi.fn();
    const user = userEvent.setup();
    render(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame({ controls: buildMixedControls() })}
        onControl={onControl}
      />,
    );

    expect(screen.getByRole("button", { name: /POS/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Go back/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Point of Sale/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Daily operations/ })).toBeNull();

    await user.click(screen.getByRole("tab", { name: /Header/ }));

    expect(screen.getByRole("button", { name: /Go back/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /POS/ })).toBeNull();

    await user.click(screen.getByRole("tab", { name: /Navigation/ }));

    expect(screen.getByRole("button", { name: /Point of Sale/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Daily operations/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Go back/ })).toBeNull();
  });

  it("returns to surface controls after an accepted navigation action", async () => {
    const onControl = vi.fn();
    const user = userEvent.setup();
    const frame = buildFrame({ controls: buildMixedControls() });
    const { rerender } = render(
      <RemoteAssistLiveViewer canControl frame={frame} onControl={onControl} />,
    );

    await user.click(screen.getByRole("tab", { name: /Navigation/ }));
    await user.click(screen.getByRole("button", { name: /Point of Sale/ }));
    const idempotencyKey = onControl.mock.calls[0][0].idempotencyKey;
    const result: RemoteAssistControlResult = {
      accepted: true,
      event: onControl.mock.calls[0][0].event,
      idempotencyKey,
      sessionId: "session-1",
    };

    rerender(
      <RemoteAssistLiveViewer
        canControl
        frame={frame}
        latestControlResult={result}
        onControl={onControl}
      />,
    );

    expect(screen.getByRole("button", { name: /POS/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Point of Sale/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /Surface/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: /Navigation/ }));

    expect(screen.getByRole("button", { name: /Point of Sale/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /POS/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /Navigation/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps the selected page surface active when only header and navigation controls are available", () => {
    const onControl = vi.fn();
    render(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame({
          controls: buildMixedControls().filter(
            (control) => getFixtureSurfaceId(control) !== "current",
          ),
        })}
        onControl={onControl}
      />,
    );

    expect(
      screen.getByText("No safe control targets are visible for this surface."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Go back/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Point of Sale/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /Surface/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows a readable current surface name from the runtime route", () => {
    const onControl = vi.fn();
    render(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame({
          route: "/wigclub/store/wigclub/pos/transactions",
          title: "Athena",
        })}
        onControl={onControl}
      />,
    );

    expect(screen.getByText("Current surface")).toBeTruthy();
    expect(screen.getByText("Transactions")).toBeTruthy();
    expect(
      screen.getByText("/wigclub/store/wigclub/pos/transactions"),
    ).toBeTruthy();
  });

  it("uses product names for known POS workspace routes", () => {
    const onControl = vi.fn();
    render(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame({
          route: "/wigclub/store/wigclub/pos/sessions",
          title: "Athena",
        })}
        onControl={onControl}
      />,
    );

    expect(screen.getByText("Active Sessions")).toBeTruthy();
  });

  it("uses store workspace routes when the runtime is mounted above POS", () => {
    const onControl = vi.fn();
    render(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame({
          route: "/wigclub/store/wigclub/cash-controls",
          title: "Point of Sale",
        })}
        onControl={onControl}
      />,
    );

    expect(screen.getByText("Cash Controls")).toBeTruthy();
    expect(screen.queryByText("Point of Sale")).toBeNull();
  });

  it("names the Reports workspace from its route", () => {
    render(
      <RemoteAssistLiveViewer
        canControl
        frame={buildFrame({
          route: "/wigclub/store/wigclub/reports/items",
          title: "Athena",
        })}
        onControl={vi.fn()}
      />,
    );

    expect(screen.getByText("Reports")).toBeTruthy();
  });
});

function getFixtureSurfaceId(
  control: RemoteAssistSanitizedSurfaceControl,
): "current" | "header" | "navigation" {
  if (control.controlId === "page-header-back") {
    return "header";
  }
  if (control.controlId.startsWith("remote-assist-")) {
    return "navigation";
  }
  return "current";
}

function buildMixedControls(): RemoteAssistSanitizedSurfaceControl[] {
  return [
    {
      controlId: "pos-workspace-pos",
      label: "POS",
      rect: {
        height: 32,
        width: 120,
        x: 10,
        y: 20,
      },
      role: "link",
    },
    {
      controlId: "page-header-back",
      label: "Go back",
      rect: {
        height: 32,
        width: 80,
        x: 10,
        y: 60,
      },
      role: "button",
    },
    {
      controlId: "remote-assist-link-point-of-sale",
      label: "Point of Sale",
      rect: {
        height: 32,
        width: 120,
        x: 10,
        y: 100,
      },
      role: "link",
    },
    {
      controlId:
        "remote-assist-link-daily-operations-wigclub-store-wigclub-operations",
      label: "Daily operations",
      rect: {
        height: 32,
        width: 150,
        x: 10,
        y: 140,
      },
      role: "link",
    },
  ];
}

function buildFrame({
  controls = [
    {
      controlId: "control-1",
      label: "Open drawer",
      rect: {
        height: 32,
        width: 120,
        x: 10,
        y: 20,
      },
      role: "button" as const,
    },
  ],
  route = "/wigclub/store/wigclub/pos",
  title = "Athena POS",
}: {
  controls?: RemoteAssistSanitizedSurfaceControl[];
  route?: string;
  title?: string;
} = {}): RemoteAssistCoBrowseFrame {
  return {
    capturedAt: Date.now(),
    frameId: "frame-1",
    redaction: {
      inputValuesMasked: true,
      sensitiveRegionCount: 0,
    },
    route,
    sensitiveRegions: [],
    sessionId: "session-1",
    surface: {
      controls,
      title,
      visibleText: ["Open drawer"],
    },
    viewport: {
      height: 720,
      width: 1280,
    },
  };
}

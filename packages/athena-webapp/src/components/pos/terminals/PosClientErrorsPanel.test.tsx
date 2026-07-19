import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PosClientErrorsMetricTileContent,
  type PosClientErrorEvent,
} from "./PosClientErrorsPanel";
import type { Id } from "~/convex/_generated/dataModel";

function buildEvent(
  overrides: Partial<PosClientErrorEvent> = {},
): PosClientErrorEvent {
  return {
    _id: "evt-1" as Id<"posClientEvent">,
    clientEventId: "client-event-1",
    level: "error",
    flow: "checkout",
    message: "Checkout failed unexpectedly",
    errorName: "TypeError",
    errorMessage: "totals is undefined",
    errorStack: "TypeError: totals is undefined\n  at completeTransaction",
    appVersion: "gentle-lion (2026)",
    terminalFingerprint: "fp-hash-1",
    localRegisterSessionId: "register-1",
    metadata: { operation: "completeTransaction" },
    occurredAt: Date.now() - 60_000,
    receivedAt: Date.now() - 30_000,
    ...overrides,
  };
}

describe("PosClientErrorsMetricTileContent", () => {
  it("renders a stable zero count while loading, with no placeholder or empty-state flash", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading
        levelFilter="all"
        onLevelFilterChange={vi.fn()}
      />,
    );

    const tile = screen.getByRole("button", { name: "Open client errors" });
    expect(tile).toHaveTextContent("0");

    await user.click(tile);
    expect(screen.queryByText(/No client errors reported/)).toBeNull();

    rerender(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading={false}
        levelFilter="all"
        onLevelFilterChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/No client errors reported/),
    ).toBeInTheDocument();
  });

  it("shows the recent-error count on the tile", () => {
    render(
      <PosClientErrorsMetricTileContent
        events={[buildEvent(), buildEvent({ clientEventId: "client-event-2" })]}
        isLoading={false}
        levelFilter="all"
        onLevelFilterChange={vi.fn()}
      />,
    );

    const tile = screen.getByRole("button", { name: "Open client errors" });
    expect(tile).toHaveTextContent("Client errors");
    expect(tile).toHaveTextContent("2");
  });

  it("opens the sheet with the event list from the tile", async () => {
    const user = userEvent.setup();
    render(
      <PosClientErrorsMetricTileContent
        events={[
          buildEvent(),
          buildEvent({
            clientEventId: "client-event-2",
            level: "warn",
            flow: "sync",
            message: "Sync retry backing off",
          }),
        ]}
        isLoading={false}
        levelFilter="all"
        onLevelFilterChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open client errors" }));

    expect(await screen.findByText("Checkout failed unexpectedly")).toBeInTheDocument();
    expect(screen.getByText("Sync retry backing off")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
  });

  it("shows an empty state in the sheet when nothing is reported", async () => {
    const user = userEvent.setup();
    render(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading={false}
        levelFilter="all"
        onLevelFilterChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open client errors" }));

    expect(
      await screen.findByText(/No client errors reported/),
    ).toBeInTheDocument();
  });

  it("requests a level change from the sheet filter", async () => {
    const user = userEvent.setup();
    const onLevelFilterChange = vi.fn();
    render(
      <PosClientErrorsMetricTileContent
        events={[buildEvent()]}
        isLoading={false}
        levelFilter="all"
        onLevelFilterChange={onLevelFilterChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open client errors" }));
    await user.click(await screen.findByRole("button", { name: "Warnings" }));

    expect(onLevelFilterChange).toHaveBeenCalledWith("warn");
  });

  it("drills into detail and returns to the list with back", async () => {
    const user = userEvent.setup();
    render(
      <PosClientErrorsMetricTileContent
        events={[buildEvent()]}
        isLoading={false}
        levelFilter="all"
        onLevelFilterChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open client errors" }));
    await user.click(await screen.findByText("Checkout failed unexpectedly"));

    expect(await screen.findByText("Client error detail")).toBeInTheDocument();
    expect(
      screen.getByText("TypeError: totals is undefined"),
    ).toBeInTheDocument();
    expect(screen.getByText(/at completeTransaction/)).toBeInTheDocument();
    expect(screen.getByText("operation")).toBeInTheDocument();
    expect(screen.getByText("completeTransaction")).toBeInTheDocument();
    expect(screen.getByText("fp-hash-1")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Back to client errors" }),
    );

    expect(
      await screen.findByText("Checkout failed unexpectedly"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Client error detail")).not.toBeInTheDocument();
  });
});

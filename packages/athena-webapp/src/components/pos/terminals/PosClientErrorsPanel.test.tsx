import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: mocks.useQuery }));

import {
  PosClientErrorsMetricTile,
  PosClientErrorsMetricTileContent,
  type PosClientErrorEvent,
} from "./PosClientErrorsPanel";
import type { Id } from "~/convex/_generated/dataModel";

function buildEvent(
  overrides: Partial<PosClientErrorEvent> = {},
): PosClientErrorEvent {
  return {
    _id: "evt-1" as Id<"posClientEvent">,
    _creationTime: 1,
    storeId: "store-1" as Id<"store">,
    clientEventId: "client-event-1",
    level: "error",
    flow: "register",
    classification: "local_storage_transaction_failed",
    message: "A local POS storage operation failed.",
    errorName: "AbortError",
    operation: "openDrawer",
    routeId: "register",
    source: { asset: "register.js", column: 7, line: 42 },
    appVersion: "gentle-lion (2026)",
    buildSha: "abc123",
    terminalId: "terminal-1" as Id<"posTerminal">,
    terminalFingerprint: "fp-hash-1",
    localRegisterSessionId: "register-1",
    metadata: { accessMode: "readwrite", storageEngine: "indexeddb" },
    occurredAt: Date.now() - 60_000,
    receivedAt: Date.now() - 30_000,
    ...overrides,
  };
}

describe("PosClientErrorsMetricTileContent", () => {
  it("contains a live query failure inside the diagnostics tile", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.useQuery.mockImplementation(() => {
      throw new Error("query unavailable");
    });

    render(
      <PosClientErrorsMetricTile
        storeId={"store-1" as Id<"store">}
        terminalId={"terminal-1" as Id<"posTerminal">}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Open client errors" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Client diagnostics are not available right now",
    );
    mocks.useQuery.mockReset();
    consoleError.mockRestore();
  });

  it("keeps the live sheet open while changing the level query", async () => {
    const user = userEvent.setup();
    mocks.useQuery.mockImplementation(
      (_reference, args: { level: "error" | "warn" }) =>
        args.level === "warn"
          ? [
              buildEvent({
                clientEventId: "warning-1",
                level: "warn",
                message: "A POS background operation needs attention.",
              }),
            ]
          : [],
    );
    render(
      <PosClientErrorsMetricTile
        storeId={"store-1" as Id<"store">}
        terminalId={"terminal-1" as Id<"posTerminal">}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Open client errors" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Client errors" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Warnings" }));

    expect(
      screen.getByRole("dialog", { name: "Client errors" }),
    ).toHaveTextContent("A POS background operation needs attention.");
    mocks.useQuery.mockReset();
  });

  it("renders a stable zero count while loading, with no placeholder or empty-state flash", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading
        levelFilter="error"
        onLevelFilterChange={vi.fn()}
      />,
    );

    const tile = screen.getByRole("button", { name: "Open client errors" });
    expect(tile).toHaveTextContent("0");

    await user.click(tile);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading client errors",
    );

    rerender(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading={false}
        levelFilter="error"
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
        levelFilter="error"
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
            message: "A POS background operation needs attention.",
          }),
        ]}
        isLoading={false}
        levelFilter="error"
        onLevelFilterChange={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open client errors" }),
    );

    expect(
      await screen.findByText("A local POS storage operation failed."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A POS background operation needs attention."),
    ).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
  });

  it("shows an empty state in the sheet when nothing is reported", async () => {
    const user = userEvent.setup();
    render(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading={false}
        levelFilter="error"
        onLevelFilterChange={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open client errors" }),
    );

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
        levelFilter="error"
        onLevelFilterChange={onLevelFilterChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open client errors" }),
    );
    expect(
      screen.queryByRole("button", { name: "All" }),
    ).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Warnings" }));

    expect(onLevelFilterChange).toHaveBeenCalledWith("warn");
  });

  it("drills into detail and returns to the list with back", async () => {
    const user = userEvent.setup();
    render(
      <PosClientErrorsMetricTileContent
        events={[buildEvent()]}
        isLoading={false}
        levelFilter="error"
        onLevelFilterChange={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open client errors" }),
    );
    const eventButton = await screen.findByRole("button", {
      name: /A local POS storage operation failed/,
    });
    await user.click(eventButton);

    expect(await screen.findByText("Client error detail")).toBeInTheDocument();
    expect(
      screen.getByText("local_storage_transaction_failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("openDrawer")).toBeInTheDocument();
    expect(screen.getByText("register.js:42:7")).toBeInTheDocument();
    expect(screen.getByText("Client-reported terminal")).toBeInTheDocument();
    expect(screen.getByText("terminal-1")).toBeInTheDocument();
    expect(screen.getByText("fp-hash-1")).toBeInTheDocument();
    expect(screen.queryByText(/totals is undefined/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Back to client errors" }),
    );

    expect(
      await screen.findByText("A local POS storage operation failed."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Client error detail")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /A local POS storage operation failed/,
      }),
    ).toHaveFocus();
  });

  it("uses distinct warning and error empty states", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading={false}
        levelFilter="error"
        onLevelFilterChange={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Open client errors" }),
    );
    expect(screen.getByText("No client errors reported")).toBeInTheDocument();

    rerender(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading={false}
        levelFilter="warn"
        onLevelFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByText("No client warnings reported")).toBeInTheDocument();
  });

  it("announces an unavailable diagnostics query", async () => {
    const user = userEvent.setup();
    render(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading={false}
        levelFilter="error"
        onLevelFilterChange={vi.fn()}
        queryUnavailable
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Open client errors" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Client diagnostics are not available right now",
    );
  });

  it("explains a degraded diagnostic delivery rail", async () => {
    const user = userEvent.setup();
    render(
      <PosClientErrorsMetricTileContent
        events={[]}
        isLoading={false}
        levelFilter="error"
        onLevelFilterChange={vi.fn()}
        railHealth="degraded"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Open client errors" }),
    );
    expect(
      screen.getByText(
        "Diagnostic delivery is degraded on this terminal. Recent events may be incomplete.",
      ),
    ).toBeInTheDocument();
  });
});

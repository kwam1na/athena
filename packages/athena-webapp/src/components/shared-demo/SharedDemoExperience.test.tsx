import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SharedDemoGuide } from "./SharedDemoGuide";
import { SharedDemoOwnerHome } from "./SharedDemoOwnerHome";
import { SharedDemoStatusBar } from "./SharedDemoStatusBar";

const routes = {
  cash: "/demo-org/store/demo-store/cash-controls",
  inventory: "/demo-org/store/demo-store/operations/stock-adjustments",
  operations: "/demo-org/store/demo-store/operations",
  orders: "/demo-org/store/demo-store/orders/ready",
  pos: "/demo-org/store/demo-store/pos",
  reports: "/demo-org/store/demo-store/reports",
  staff: "/demo-org/store/demo-store/staff-messages",
};

describe("SharedDemoOwnerHome", () => {
  it("orients an owner across six real Athena routes without inventing a seventh reports workflow", () => {
    render(<SharedDemoOwnerHome routes={routes} />);

    expect(screen.getByRole("heading", { name: "See what is happening today" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(7);
    expect(screen.getByRole("link", { name: /Make a sale/ })).toHaveAttribute("href", routes.pos);
    expect(screen.getByRole("link", { name: /Manage stock/ })).toHaveAttribute("href", routes.inventory);
    expect(screen.getByRole("link", { name: /Control cash/ })).toHaveAttribute("href", routes.cash);
    expect(screen.getByRole("link", { name: /Fulfill an order/ })).toHaveAttribute("href", routes.orders);
    expect(screen.getByRole("link", { name: /Coordinate the team/ })).toHaveAttribute("href", routes.staff);
    expect(screen.getByRole("link", { name: /Run today/ })).toHaveAttribute("href", routes.operations);
    expect(screen.getByRole("link", { name: /Open Reports/ })).toHaveAttribute("href", routes.reports);
  });
});

describe("SharedDemoStatusBar", () => {
  it("discloses shared writes, hourly restoration, and the sensitive-data boundary before actions", () => {
    render(<SharedDemoStatusBar homeHref="/demo-home" onRestore={vi.fn()} restoreStatus="ready" />);

    expect(screen.getByText("Shared demo store")).toBeInTheDocument();
    expect(screen.getByText(/Other visitors may change this store/)).toBeInTheDocument();
    expect(screen.getByText(/Do not enter real personal, payment, or credential information/)).toBeInTheDocument();
  });

  it("confirms shared impact and announces restore progress and completion", async () => {
    let finishRestore: (() => void) | undefined;
    const onRestore = vi.fn(() => new Promise<void>((resolve) => { finishRestore = resolve; }));
    const { rerender } = render(<SharedDemoStatusBar homeHref="/demo-home" onRestore={onRestore} restoreStatus="ready" />);

    fireEvent.click(screen.getByRole("button", { name: "Restore demo" }));
    expect(screen.getByText(/removes demo changes for everyone currently using it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore shared demo" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Restoring the shared demo store…")).toBeInTheDocument();
    finishRestore?.();
    await waitFor(() => expect(screen.queryByText("Restoring the shared demo store…")).not.toBeInTheDocument());

    rerender(<SharedDemoStatusBar homeHref="/demo-home" onRestore={onRestore} restoreStatus="restoring" />);
    expect(screen.getByText("The shared demo is being restored. Try your action again shortly.")).toBeInTheDocument();
  });
});

describe("SharedDemoGuide", () => {
  it("opens optional route guidance and returns focus to its trigger", async () => {
    render(<SharedDemoGuide area="Cash Controls" homeHref="/demo-home" />);
    const trigger = screen.getByRole("button", { name: "Open demo guide" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/No bank or payment movement occurs/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AthenaBoundaryWalkthrough } from "./AthenaBoundaryWalkthrough";

vi.mock("animejs", () => ({
  animate: vi.fn(() => ({ revert: vi.fn() })),
  createTimeline: vi.fn(() => ({
    add: vi.fn().mockReturnThis(),
    revert: vi.fn(),
  })),
  stagger: vi.fn(() => 0),
}));

describe("AthenaBoundaryWalkthrough", () => {
  it("renders the architecture walkthrough with the first boundary selected", () => {
    render(<AthenaBoundaryWalkthrough />);

    expect(
      screen.getByRole("heading", {
        name: "Walk the boundaries before changing the system.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Browser Router And Protected App Shell",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("src/routes/_authed.tsx")).toBeInTheDocument();
    expect(screen.getByText("Must not grant")).toBeInTheDocument();
  });

  it("moves through layers with the walkthrough controls", async () => {
    const user = userEvent.setup();
    render(<AthenaBoundaryWalkthrough />);

    await user.click(
      screen.getByRole("button", { name: "Next layer: POS route" }),
    );

    expect(
      screen.getByRole("heading", {
        name: "POS Route-Scoped App-Session Continuity",
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Jump to local-first" }),
    );

    expect(
      screen.getByRole("heading", { name: "Local POS Event Ledger" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "IndexedDB-backed terminal seed, catalog snapshot, register state, event log, and local-to-cloud mappings.",
      ),
    ).toBeInTheDocument();
  });
});

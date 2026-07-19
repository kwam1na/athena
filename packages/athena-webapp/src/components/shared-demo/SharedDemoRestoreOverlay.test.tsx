import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedDemoRestoreOverlay } from "./sharedDemoRestoreOverlay";

describe("SharedDemoRestoreOverlay", () => {
  let appRoot: HTMLDivElement;

  beforeEach(() => {
    appRoot = document.createElement("div");
    appRoot.id = "app";
    document.body.appendChild(appRoot);
  });

  afterEach(() => {
    cleanup();
    appRoot.remove();
  });

  it("blocks the app and explains the active restore", () => {
    render(
      <SharedDemoRestoreOverlay
        isRetrying={false}
        onRetry={vi.fn()}
        phase="restoring"
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Resetting demo store" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByText(
        "Restoring the original demo data. This usually takes a moment.",
      ),
    ).toBeInTheDocument();
    expect(appRoot.inert).toBe(true);
  });

  it("offers one retry action after a restore failure", () => {
    const onRetry = vi.fn();
    render(
      <SharedDemoRestoreOverlay
        isRetrying={false}
        onRetry={onRetry}
        phase="failed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("dialog", { name: "Demo refresh paused" }),
    ).toHaveAttribute("aria-busy", "false");
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getCustomerErrorMessage, PageState } from "./PageState";

describe("PageState", () => {
  afterEach(cleanup);

  it("announces loading without presenting a blank viewport", () => {
    render(
      <PageState
        state="loading"
        title="Loading your bag"
        description="This should only take a moment."
      />,
    );

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading your bag")).toBeVisible();
  });

  it("uses an alert for errors and renders explicit recovery actions", () => {
    render(
      <PageState
        state="error"
        title="We couldn't load your bag"
        description="Try again."
        primaryAction={<button>Retry</button>}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Try again.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("does not imply recovery for terminal states", () => {
    render(
      <PageState
        state="terminal"
        title="This checkout has expired"
        description="Start a new checkout to continue."
      />,
    );

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-state",
      "terminal",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("normalizes unexpected backend errors into safe customer copy", () => {
    const message = getCustomerErrorMessage(
      new Error("Authorization failed for secret-token-123"),
    );

    expect(message).not.toContain("secret-token-123");
    expect(message).toBe(
      "Something went wrong. Try again, or return to the storefront.",
    );
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

import { WalkthroughRequestForm } from "./WalkthroughRequestForm";

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Ama Mensah");
  await user.type(screen.getByLabelText("Work email"), "ama@example.com");
  await user.type(screen.getByLabelText("Business name"), "Market House");
  await user.type(
    screen.getByLabelText("What would you like more visibility into?"),
    "I need a clearer view of daily sales and stock movement.",
  );
}

describe("WalkthroughRequestForm", () => {
  it("moves focus to the first invalid field and explains each required value", async () => {
    const user = userEvent.setup();
    render(<WalkthroughRequestForm submissionEnabled submitRequest={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Send my details" }));

    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByText("Enter your name.")).toBeVisible();
    expect(screen.getByText("Enter a valid work email.")).toBeVisible();
    expect(screen.getByText("Enter your business name.")).toBeVisible();
    expect(screen.getByText("Tell us a little more about what you want to see.")).toBeVisible();
  });

  it("replaces the form with durable confirmation after accepted", async () => {
    const user = userEvent.setup();
    const submitRequest = vi.fn().mockResolvedValue({ kind: "accepted" });
    render(<WalkthroughRequestForm submissionEnabled submitRequest={submitRequest} />);
    await fillValidForm(user);

    await user.click(screen.getByRole("button", { name: "Send my details" }));

    expect(await screen.findByRole("heading", { name: "Request received" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Request received" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Back to Athena overview" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Send my details" })).not.toBeInTheDocument();
  });

  it("locks repeated submission while a request is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (value: { kind: "accepted" }) => void;
    const submitRequest = vi.fn(() => new Promise<{ kind: "accepted" }>((resolve) => {
      resolveRequest = resolve;
    }));
    render(<WalkthroughRequestForm submissionEnabled submitRequest={submitRequest} />);
    await fillValidForm(user);

    const button = screen.getByRole("button", { name: "Send my details" });
    await user.dblClick(button);

    expect(submitRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    resolveRequest({ kind: "accepted" });
    expect(await screen.findByText("Request received")).toBeVisible();
  });

  it("retains values and identity on recoverable retry, then rotates after an edit", async () => {
    const user = userEvent.setup();
    const submitRequest = vi.fn()
      .mockResolvedValueOnce({ kind: "temporarily_unavailable" })
      .mockResolvedValueOnce({ kind: "temporarily_unavailable" })
      .mockResolvedValueOnce({ kind: "accepted" });
    render(<WalkthroughRequestForm submissionEnabled submitRequest={submitRequest} />);
    await fillValidForm(user);

    const submit = () => user.click(screen.getByRole("button", { name: "Send my details" }));
    await submit();
    expect(await screen.findByText(/Request not sent/)).toBeVisible();
    const firstKey = submitRequest.mock.calls[0][0].submissionKey;
    expect(screen.getByLabelText("Business name")).toHaveValue("Market House");

    await submit();
    expect(submitRequest.mock.calls[1][0].submissionKey).toBe(firstKey);

    const need = screen.getByLabelText("What would you like more visibility into?");
    await user.type(need, " I also need reorder context.");
    await submit();
    expect(submitRequest.mock.calls[2][0].submissionKey).not.toBe(firstKey);
    expect(await screen.findByText("Request received")).toBeVisible();
  });

  it("rotates an identity after a payload conflict without revealing prior request state", async () => {
    const user = userEvent.setup();
    const submitRequest = vi.fn()
      .mockResolvedValueOnce({ kind: "retry_required" })
      .mockResolvedValueOnce({ kind: "accepted" });
    render(<WalkthroughRequestForm submissionEnabled submitRequest={submitRequest} />);
    await fillValidForm(user);

    await user.click(screen.getByRole("button", { name: "Send my details" }));
    expect(await screen.findByText(/Try again to send a new request/)).toBeVisible();
    const conflictedKey = submitRequest.mock.calls[0][0].submissionKey;

    await user.click(screen.getByRole("button", { name: "Send my details" }));
    expect(submitRequest.mock.calls[1][0].submissionKey).not.toBe(conflictedKey);
    expect(await screen.findByText("Request received")).toBeVisible();
    expect(screen.queryByText(/prior|duplicate|existing/i)).not.toBeInTheDocument();
  });

  it("keeps the privacy details reachable before submission", () => {
    render(<WalkthroughRequestForm submissionEnabled submitRequest={vi.fn()} />);
    expect(screen.getByRole("link", { name: "privacy and retention details" }))
      .toHaveAttribute("href", "/privacy");
  });

  it("marks required fields for assistive technology", () => {
    render(<WalkthroughRequestForm submissionEnabled submitRequest={vi.fn()} />);

    expect(screen.getByLabelText("Name")).toBeRequired();
    expect(screen.getByLabelText("Work email")).toBeRequired();
    expect(screen.getByLabelText("Business name")).toBeRequired();
    expect(
      screen.getByLabelText("What would you like more visibility into?"),
    ).toBeRequired();
    expect(screen.getByLabelText("Phone (optional)")).not.toBeRequired();
  });
});

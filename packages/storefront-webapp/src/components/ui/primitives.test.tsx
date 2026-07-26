import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Field } from "./field";
import { IconButton } from "./icon-button";
import { InlineAlert } from "./inline-alert";
import { Input } from "./input";
import { LoadingButton } from "./loading-button";
import { StatusBadge } from "./status-badge";
import { StorefrontImage } from "./storefront-image";

describe("storefront primitive contracts", () => {
  afterEach(cleanup);

  it("keeps actions focusable, visibly focused, and at least 44px tall", () => {
    render(
      <>
        <Button>Continue</Button>
        <Button size="sm">Compact action</Button>
      </>,
    );

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveClass("min-h-control-standard");
    expect(button).toHaveClass("focus-visible:ring-2");
    expect(
      screen.getByRole("button", { name: "Compact action" }),
    ).toHaveClass("min-h-control-standard", "h-control-compact");
  });

  it("makes a loading action natively disabled, busy, named, and repeat-safe", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <LoadingButton isLoading onClick={onClick}>
        Place order
      </LoadingButton>,
    );

    const button = screen.getByRole("button", { name: "Place order" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("requires an explicit accessible name for icon-only actions", () => {
    render(
      <IconButton label="Remove item">
        <span aria-hidden="true">×</span>
      </IconButton>,
    );

    expect(
      screen.getByRole("button", { name: "Remove item" }),
    ).toHaveClass("min-h-control-standard", "min-w-control-standard");
  });

  it("associates field labels, hints, errors, required, and disabled state", () => {
    render(
      <Field
        label="Email"
        hint="We use this for order updates."
        error="Enter a valid email."
        required
        disabled
      >
        <Input type="email" />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: /email/i });
    const hint = screen.getByText("We use this for order updates.");
    const error = screen.getByText("Enter a valid email.");

    expect(input).toBeDisabled();
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(hint.id);
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
    expect(error).toHaveAttribute("role", "alert");
  });

  it("gives semantic feedback text and live-region behavior", () => {
    render(
      <>
        <StatusBadge tone="warning">Low inventory</StatusBadge>
        <InlineAlert tone="danger" title="Payment failed">
          Try another payment method.
        </InlineAlert>
      </>,
    );

    expect(screen.getByText("Low inventory")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Try another payment method.",
    );
  });

  it("uses a fallback image once and terminates after fallback failure", () => {
    render(
      <StorefrontImage
        src="/product.jpg"
        fallbackSrc="/fallback.jpg"
        alt="Silk scarf"
        fallback={<span>Image unavailable</span>}
      />,
    );

    const image = screen.getByRole("img", { name: "Silk scarf" });
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "/fallback.jpg");

    fireEvent.error(image);
    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

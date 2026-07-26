import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { Modal } from "./modal";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

describe("overlay contracts", () => {
  afterEach(cleanup);

  it("names a dialog once, closes with Escape, and restores trigger focus", async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger>Open details</DialogTrigger>
        <DialogContent>
          <DialogTitle>Order details</DialogTitle>
          <DialogDescription>Review this order.</DialogDescription>
          <button>Confirm</button>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "Open details" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Order details");
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("allows Radix to place initial focus inside a sheet", async () => {
    const user = userEvent.setup();

    render(
      <Sheet>
        <SheetTrigger>Open bag</SheetTrigger>
        <SheetContent>
          <SheetTitle>Your bag</SheetTitle>
          <SheetDescription>Items saved for checkout.</SheetDescription>
          <button>Checkout</button>
        </SheetContent>
      </Sheet>,
    );

    await user.click(screen.getByRole("button", { name: "Open bag" }));
    expect(screen.getByRole("button", { name: "Checkout" })).toHaveFocus();
  });

  it("renders one accessible title through the compatibility Modal", () => {
    render(
      <Modal
        title="Join the list"
        description="Get product updates."
        isOpen
        onClose={vi.fn()}
      >
        Content
      </Modal>,
    );

    expect(screen.getAllByText("Join the list")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Join the list");
  });
});

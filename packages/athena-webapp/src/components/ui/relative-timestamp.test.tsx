import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatAbsoluteTimestamp } from "@/lib/utils";

import { RelativeTimestamp } from "./relative-timestamp";

const NOW = new Date("2026-08-02T12:00:00.000Z").getTime();

afterEach(() => {
  vi.useRealTimers();
});

function freezeClock() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

describe("RelativeTimestamp", () => {
  it("renders the relative label and keeps the absolute timestamp out of the page until hover", () => {
    freezeClock();
    const completedAt = NOW - 5 * 60 * 1000;

    render(<RelativeTimestamp value={completedAt} />);

    const element = screen.getByText("5 minutes ago");
    expect(element.tagName).toBe("TIME");
    expect(element).not.toHaveAttribute("title");
    expect(element).toHaveAttribute(
      "dateTime",
      new Date(completedAt).toISOString(),
    );
    expect(
      screen.queryByText(formatAbsoluteTimestamp(completedAt)),
    ).not.toBeInTheDocument();
  });

  it("reveals the absolute timestamp in a tooltip on hover", async () => {
    const completedAt = Date.now() - 5 * 60 * 1000;

    render(<RelativeTimestamp value={completedAt} />);

    await userEvent.hover(screen.getByText("5 minutes ago"));

    expect(
      await screen.findAllByText(formatAbsoluteTimestamp(completedAt)),
    ).not.toHaveLength(0);
  });

  it("prefixes the relative label when a prefix is supplied", () => {
    freezeClock();

    render(
      <RelativeTimestamp prefix="Completed" value={NOW - 60 * 60 * 1000} />,
    );

    expect(screen.getByText("Completed 1 hour ago")).toBeInTheDocument();
  });

  it("renders the fallback instead of a tooltip when there is no timestamp", () => {
    render(<RelativeTimestamp fallback="Not scheduled" value={undefined} />);

    expect(screen.getByText("Not scheduled")).toBeInTheDocument();
    expect(screen.queryByRole("time")).not.toBeInTheDocument();
  });

  it("omits the time from the tooltip label at date precision", async () => {
    const value = Date.now();

    render(<RelativeTimestamp precision="date" value={value} />);

    await userEvent.hover(screen.getByText("now"));

    expect(
      await screen.findAllByText(formatAbsoluteTimestamp(value, "date")),
    ).not.toHaveLength(0);
  });
});

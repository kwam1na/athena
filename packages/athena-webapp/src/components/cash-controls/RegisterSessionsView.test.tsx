import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RegisterSessionsViewContent } from "./RegisterSessionsView";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    search?: Record<string, string>;
    to?: string;
  }) => {
    void params;
    const searchParams = search ? `?${new URLSearchParams(search)}` : "";

    return (
      <a href={`${to ?? "#"}${searchParams}`} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({ orgUrlSlug: "wigclub", storeUrlSlug: "wigclub" }),
  useNavigate: () => vi.fn(),
  useSearch: () => ({ o: "%2Fwigclub%2Fstore%2Fwigclub%2Fcash-controls" }),
}));

vi.mock("../common/PageHeader", () => ({
  NavigateBackButton: () => <button type="button">Back</button>,
}));

describe("RegisterSessionsViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  it("renders all register sessions in a ledger table", () => {
    const closedAt = new Date("2026-04-29T18:30:00.000Z").getTime();
    const openedAt = new Date("2026-04-29T07:40:00.000Z").getTime();
    const expectedTimelineDate = new Date(openedAt).toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
      },
    );
    const expectedTimelineRange = `${new Date(openedAt).toLocaleTimeString(
      "en-US",
      {
        hour: "numeric",
        minute: "2-digit",
      },
    )} - ${new Date(closedAt).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;

    render(
      <RegisterSessionsViewContent
        currency="GHS"
        isLoading={false}
        orgUrlSlug="wigclub"
        registerSessions={[
          {
            _id: "session-active",
            expectedCash: 969000,
            openedAt: new Date("2026-04-29T07:23:00.000Z").getTime(),
            openedByStaffName: "Kwamina Mensah",
            openingFloat: 25000,
            registerNumber: "Register 3",
            status: "active",
            totalDeposited: 400000,
            variance: 0,
          },
          {
            _id: "session-closed",
            closedAt,
            countedCash: 20000,
            expectedCash: 40000,
            openedAt,
            openedByStaffName: "Ato Kofi",
            openingFloat: 40000,
            registerNumber: "Register 2",
            status: "closed",
            totalDeposited: 0,
            variance: -20000,
          },
        ]}
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("Register sessions")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Review drawer ownership, closeout timing, and cash discrepancies.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("2 sessions")).toBeInTheDocument();
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.queryByText("State")).not.toBeInTheDocument();
    expect(screen.getByText("Operator")).toBeInTheDocument();
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByText("Cash position")).toBeInTheDocument();
    expect(screen.getByText("Discrepancy")).toBeInTheDocument();
    expect(screen.getByText("Register 3")).toBeInTheDocument();
    expect(screen.getByText("Register 2")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
    expect(screen.getByText("Kwamina M.")).toBeInTheDocument();
    expect(screen.getByText("Ato K.")).toBeInTheDocument();
    expect(screen.getByText("GH₵9,690")).toBeInTheDocument();
    expect(screen.getByText("GH₵-200")).toBeInTheDocument();
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    expect(screen.getByText("Short")).toBeInTheDocument();
    expect(screen.getByText(/ - now$/)).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getAllByText(expectedTimelineDate).length).toBeGreaterThan(0);
    expect(screen.getByText(expectedTimelineRange)).toBeInTheDocument();
    expect(screen.getByText("10 hr 50 min")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Register 3 ACTIVE/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId?o=%252F",
    );
  });

  it("renders an empty state when there are no sessions", () => {
    render(
      <RegisterSessionsViewContent
        currency="GHS"
        isLoading={false}
        orgUrlSlug="wigclub"
        registerSessions={[]}
        storeUrlSlug="wigclub"
      />,
    );

    expect(screen.getByText("No register sessions")).toBeInTheDocument();
  });
});

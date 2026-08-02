import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ state: {} as unknown }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search }: { children: React.ReactNode; search: unknown }) => (
    <a data-search={JSON.stringify(search)} href="/reports/weekly">
      {children}
    </a>
  ),
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ location: { state: router.state } }),
}));

import { ReportsWeeklyReturnLink } from "./ReportsWeeklyReturnLink";

describe("ReportsWeeklyReturnLink", () => {
  beforeEach(() => {
    router.state = {};
  });

  it("restores a validated selected historical report", () => {
    router.state = {
      reportsWeeklyReturn: {
        reportId: "week:2026-07-07",
        history: true,
        ignored: "discarded",
      },
    };

    render(<ReportsWeeklyReturnLink />);

    expect(
      screen.getByRole("link", { name: "Return to selected Weekly report" }),
    ).toHaveAttribute(
      "data-search",
      JSON.stringify({ reportId: "week:2026-07-07", history: true }),
    );
  });

  it("restores the same active Weekly selection without a report id", () => {
    router.state = {
      reportsWeeklyReturn: {
        history: true,
        overviewWindow: "weekToDate",
      },
    };

    render(<ReportsWeeklyReturnLink />);

    expect(
      screen.getByRole("link", { name: "Return to selected Weekly report" }),
    ).toHaveAttribute(
      "data-search",
      JSON.stringify({ history: true, overviewWindow: "weekToDate" }),
    );
  });

  it("offers no return path for malformed state", () => {
    router.state = {
      reportsWeeklyReturn: { reportId: "not-a-week", history: true },
    };
    render(<ReportsWeeklyReturnLink />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

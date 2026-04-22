import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { WorkflowTraceRouteShell } from "./$traceId";

const mockedHooks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useQuery: vi.fn(),
  notFoundView: vi.fn(
    ({ entity, entityIdentifier }: { entity: string; entityIdentifier: string }) => (
      <div data-testid="not-found-view">{`${entity}:${entityIdentifier}`}</div>
    ),
  ),
  workflowTraceView: vi.fn(
    (_props: { storeId: Id<"store">; traceId: string }) => (
      <div data-testid="workflow-trace-view" />
    ),
  ),
}));

vi.mock("convex/react", () => ({
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockedHooks.useAuth,
}));

vi.mock("~/src/components/states/not-found/NotFoundView", () => ({
  NotFoundView: mockedHooks.notFoundView,
}));

vi.mock("~/src/components/traces/WorkflowTraceView", () => ({
  WorkflowTraceView: mockedHooks.workflowTraceView,
}));

describe("WorkflowTraceRouteShell", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockedHooks.useAuth.mockReturnValue({
      isLoading: false,
      user: { _id: "user-1" },
    });
  });

  it("uses the slug-matched store when loading the workflow trace", () => {
    mockedHooks.useQuery
      .mockReturnValueOnce([
        {
          _id: "org-1" as Id<"organization">,
          slug: "v26",
        },
      ])
      .mockReturnValueOnce([
        {
          _id: "store-wrong" as Id<"store">,
          slug: "accra-flagship",
        },
        {
          _id: "store-matched" as Id<"store">,
          slug: "east-legon",
        },
      ]);

    render(
      <WorkflowTraceRouteShell
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
        traceId="repair_order:job-42"
      />,
    );

    expect(mockedHooks.useQuery).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        userId: "user-1",
      },
    );
    expect(mockedHooks.useQuery).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        organizationId: "org-1",
      },
    );

    const workflowTraceProps = mockedHooks.workflowTraceView.mock.calls[0]?.[0];
    expect(workflowTraceProps).toEqual({
      storeId: "store-matched",
      traceId: "repair_order:job-42",
    });
    expect(screen.getByTestId("workflow-trace-view")).toBeInTheDocument();
  });

  it("shows organization not found when the org slug is invalid", () => {
    mockedHooks.useQuery.mockReturnValueOnce([
      {
        _id: "org-1" as Id<"organization">,
        slug: "v26",
      },
    ]);

    render(
      <WorkflowTraceRouteShell
        orgUrlSlug="missing-org"
        storeUrlSlug="east-legon"
        traceId="repair_order:job-42"
      />,
    );

    expect(mockedHooks.notFoundView.mock.calls[0]?.[0]).toEqual({
      entity: "organization",
      entityIdentifier: "missing-org",
    });
    expect(screen.getByTestId("not-found-view")).toHaveTextContent(
      "organization:missing-org",
    );
    expect(screen.queryByText("Loading workflow trace...")).not.toBeInTheDocument();
    expect(mockedHooks.workflowTraceView).not.toHaveBeenCalled();
  });
});

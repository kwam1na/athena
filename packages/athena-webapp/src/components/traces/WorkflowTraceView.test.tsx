import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { WorkflowTraceTimeline, WorkflowTraceView } from "./WorkflowTraceView";

const mockedHooks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: mockedHooks.useQuery,
}));

vi.mock("../common/PageHeader", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  NavigateBackButton: () => null,
}));

describe("WorkflowTraceView", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the trace title, health and status badges, and ordered timeline messages", () => {
    mockedHooks.useQuery.mockReturnValue({
      events: [
        {
          kind: "system_action",
          message: "Repair order persisted",
          occurredAt: new Date("2026-04-21T09:20:00.000Z").getTime(),
          sequence: 4,
          source: "workflow.shared",
          status: "succeeded",
          step: "repair_order_persisted",
          traceId: "repair_order:job-42",
          workflowType: "repair_order",
        },
        {
          kind: "milestone",
          message: "Workflow started",
          occurredAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
          sequence: 2,
          source: "workflow.shared",
          status: "started",
          step: "workflow_started",
          traceId: "repair_order:job-42",
          workflowType: "repair_order",
        },
      ],
      header: {
        health: "partial",
        primaryLookupType: "reference_number",
        primaryLookupValue: "JOB-42",
        status: "succeeded",
        summary: "Updated",
        title: "Repair order JOB-42",
        traceId: "repair_order:job-42",
        workflowType: "repair_order",
      },
    });

    render(
      <WorkflowTraceView
        storeId={"store-1" as Id<"store">}
        traceId="repair_order:job-42"
      />,
    );

    expect(screen.getAllByText("Succeeded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partial").length).toBeGreaterThan(0);
    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
    expect(listItems[0]).toHaveTextContent("Workflow started");
    expect(listItems[1]).toHaveTextContent("Repair order persisted");
  });
});

describe("WorkflowTraceTimeline", () => {
  it("renders events as a simple ActivityView-like bullet timeline", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-04-21T09:25:00.000Z").getTime(),
    );

    render(
      <WorkflowTraceTimeline
        events={[
          {
            kind: "milestone",
            message: "Workflow started",
            occurredAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
            sequence: 2,
            source: "workflow.shared",
            status: "started",
            step: "workflow_started",
            traceId: "repair_order:job-42",
            workflowType: "repair_order",
          },
          {
            kind: "system_action",
            message: "Repair order persisted",
            occurredAt: new Date("2026-04-21T09:20:00.000Z").getTime(),
            sequence: 4,
            source: "workflow.shared",
            status: "succeeded",
            step: "repair_order_persisted",
            traceId: "repair_order:job-42",
            workflowType: "repair_order",
          },
        ]}
      />,
    );

    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
    expect(listItems[0]).toHaveTextContent("Workflow started");
    expect(listItems[0]).not.toHaveTextContent("Workflow Started");
    expect(listItems[0]).toHaveTextContent("10 minutes ago");
    expect(listItems[0]).toHaveTextContent("Started");
    expect(listItems[0]).toHaveTextContent("Milestone");
    expect(listItems[1]).toHaveTextContent("Repair order persisted");
    expect(listItems[1]).not.toHaveTextContent("Repair Order Persisted");
    expect(listItems[1]).toHaveTextContent("5 minutes ago");
    expect(listItems[1]).toHaveTextContent("Succeeded");
    expect(listItems[1]).toHaveTextContent("System Action");
  });
});

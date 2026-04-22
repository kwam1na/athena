import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { WorkflowTraceView } from "./WorkflowTraceView";

const mockedHooks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: mockedHooks.useQuery,
}));

describe("WorkflowTraceView", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
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

    expect(screen.getByText("Repair order JOB-42")).toBeInTheDocument();
    expect(screen.getAllByText("Succeeded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partial").length).toBeGreaterThan(0);
    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
    expect(listItems[0]).toHaveTextContent("Workflow started");
    expect(listItems[1]).toHaveTextContent("Repair order persisted");
  });
});

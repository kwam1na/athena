import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { WorkflowTraceTimeline, WorkflowTraceView } from "./WorkflowTraceView";

const mockedHooks = vi.hoisted(() => ({
  useGetTerminal: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: React.ReactNode; params: { transactionId: string } }) => (
    <a href={`/transactions/${params.transactionId}`}>{children}</a>
  ),
  useParams: () => ({ orgUrlSlug: "wigclub", storeUrlSlug: "wigclub" }),
}));

vi.mock("@/hooks/useGetTerminal", () => ({
  useGetTerminal: mockedHooks.useGetTerminal,
}));

vi.mock("../common/PageHeader", () => ({
  ComposedPageHeader: ({
    leadingContent,
  }: {
    leadingContent: React.ReactNode;
  }) => <div data-testid="workflow-trace-page-header">{leadingContent}</div>,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-trace-page-header">{children}</div>
  ),
  NavigateBackButton: () => null,
}));

describe("WorkflowTraceView", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    mockedHooks.useGetTerminal.mockReturnValue({
      _id: "terminal-1",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a lightweight register trace header, quiet diagnostics, and ordered timeline messages", () => {
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
        health: "healthy",
        primaryLookupType: "register_session_id",
        primaryLookupValue: "register-session-42",
        registerSession: {
          _id: "register-session-42",
          registerNumber: "07",
          terminalName: "Olorin",
        },
        status: "blocked",
        summary: "Trace for register session 07",
        title: "Register session 07",
        traceId: "register_session:register-session-42",
        workflowType: "register_session",
      },
    });

    render(
      <WorkflowTraceView
        storeId={"store-1" as Id<"store">}
        traceId="register_session:register-session-42"
      />,
    );

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(expect.anything(), {
      storeId: "store-1",
      terminalId: "terminal-1",
      traceId: "register_session:register-session-42",
    });
    expect(screen.getByTestId("workflow-trace-page-header")).toHaveTextContent(
      /Register 07\s*\/\s*Olorin\s*\/\s*ION-42\s*\/\s*History/,
    );
    expect(
      screen.getByTestId("workflow-trace-page-header"),
    ).not.toHaveTextContent(
      /Blocked|Healthy|Primary lookup|Register Session Id/,
    );
    expect(
      screen.queryByRole("region", { name: "History details" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("State: Blocked")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Health: Healthy")).not.toBeInTheDocument();
    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
    expect(listItems[0]).toHaveTextContent("Workflow started");
    expect(listItems[1]).toHaveTextContent("Repair order persisted");
  });

  it("renders a generic trace title with the history suffix", () => {
    mockedHooks.useQuery.mockReturnValue({
      events: [],
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

    expect(screen.getByTestId("workflow-trace-page-header")).toHaveTextContent(
      /Repair order JOB-42\s*\/\s*History/,
    );
  });
});

describe("WorkflowTraceTimeline", () => {
  it("renders events as a simple ActivityView-like bullet timeline", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-04-21T09:25:00.000Z").getTime(),
    );
    const workflowStartedAt = new Date("2026-04-21T09:15:00.000Z").getTime();

    render(
      <WorkflowTraceTimeline
        events={[
          {
            details: {
              openedBy: "Ato Kwamina",
              openingFloat: 0,
              registerNumber: "07",
              terminal: "Codex II",
            },
            kind: "milestone",
            message: "Workflow started",
            occurredAt: workflowStartedAt,
            sequence: 2,
            source: "workflow.shared",
            status: "started",
            step: "register_session_opened",
            traceId: "repair_order:job-42",
            workflowType: "repair_order",
          },
          {
            details: {
              countedCash: 30000,
              expectedCash: 24000,
              closedBy: "Ato Kwamina",
              registerNumber: "07",
              registerStatus: "closed",
              transactionId: "internal-transaction-id",
              variance: 6000,
            },
            kind: "system_action",
            message: "Repair order persisted",
            occurredAt: new Date("2026-04-21T09:20:00.000Z").getTime(),
            sequence: 4,
            source: "workflow.shared",
            status: "succeeded",
            step: "register_session_closed",
            traceId: "repair_order:job-42",
            workflowType: "repair_order",
          },
        ]}
      />,
    );

    const listItems = screen.getAllByRole("listitem");
    expect(listItems).toHaveLength(2);
    expect(listItems[0]).toHaveTextContent(
      "Ato Kwamina opened Register 07 on Codex II with no opening float.",
    );
    expect(listItems[0]).toHaveTextContent("10 minutes ago");
    expect(screen.queryByTitle(/Apr 21, 2026/)).not.toBeInTheDocument();
    expect(listItems[0]).toHaveTextContent("Started");
    expect(listItems[0]).toHaveTextContent("Milestone");
    expect(listItems[1]).toHaveTextContent(
      "Ato Kwamina closed Register 07 with GH₵300 counted against GH₵240 expected, a GH₵60 overage.",
    );
    expect(listItems[1]).toHaveTextContent("5 minutes ago");
    expect(listItems[1]).toHaveTextContent("Succeeded");
    expect(listItems[1]).toHaveTextContent("System Action");
    expect(listItems[1]).not.toHaveTextContent("internal-transaction-id");
  });

  it("humanizes register transaction events as operational statements", () => {
    render(
      <WorkflowTraceTimeline
        events={[
          {
            details: {
              actorName: "Ato Kwamina",
              cashDelta: 24000,
              paymentMethodLabels: ["cash"],
              saleTotal: 24000,
              transactionId: "transaction-1",
              transactionNumber: "047206",
            },
            kind: "system_action",
            message: "Recorded transaction sale",
            occurredAt: Date.now(),
            sequence: 1,
            source: "workflow.registerSession",
            status: "info",
            step: "register_session_sale_recorded",
            traceId: "register_session:session-1",
            workflowType: "register_session",
          },
        ]}
      />,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Ato Kwamina recorded transaction #047206, a GH₵240 cash sale. Drawer +GH₵240.",
    );
    expect(screen.getByRole("link", { name: "#047206" })).toHaveAttribute(
      "href",
      "/transactions/transaction-1",
    );
    expect(screen.getByRole("listitem")).not.toHaveTextContent("Open #047206");
  });

  it("identifies who recorded and approved a future transaction void", () => {
    render(
      <WorkflowTraceTimeline
        events={[
          {
            details: {
              actorName: "Ato Kwamina",
              approvedByName: "Kwamina Mensah",
              amount: 1_250_000,
              cashDelta: 0,
              saleTotal: 1_250_000,
              transactionId: "transaction-1",
              transactionNumber: "155431",
            },
            kind: "system_action",
            message: "Recorded transaction void",
            occurredAt: Date.now(),
            sequence: 1,
            source: "workflow.registerSession",
            status: "info",
            step: "register_session_void_recorded",
            traceId: "register_session:session-1",
            workflowType: "register_session",
          },
        ]}
      />,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Ato Kwamina recorded a GH₵12,500 void for transaction #155431. Approved by Kwamina Mensah. No drawer impact.",
    );
    expect(screen.getByRole("link", { name: "#155431" })).toHaveAttribute(
      "href",
      "/transactions/transaction-1",
    );
    expect(screen.getByRole("listitem")).not.toHaveTextContent("Open #155431");
  });

  it("adds cash context to closeout submission statements", () => {
    render(
      <WorkflowTraceTimeline
        events={[
          {
            details: {
              actorName: "Ato Kwamina",
              countedCash: 30000,
              expectedCash: 24000,
              registerNumber: "07",
              variance: 6000,
            },
            kind: "milestone",
            message: "Register closeout submitted.",
            occurredAt: Date.now(),
            sequence: 1,
            source: "workflow.registerSession",
            status: "started",
            step: "register_session_closeout_submitted",
            traceId: "register_session:session-1",
            workflowType: "register_session",
          },
        ]}
      />,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Ato Kwamina submitted the closeout for Register 07 with GH₵300 counted against GH₵240 expected, a GH₵60 overage.",
    );
  });
});

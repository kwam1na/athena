import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../workflowTraces/core";

import { recordRegisterSessionTraceBestEffort } from "./registerSessionTracing";

vi.mock("../workflowTraces/core", () => ({
  appendWorkflowTraceEventWithCtx: vi.fn(),
  createWorkflowTraceWithCtx: vi.fn(),
  registerWorkflowTraceLookupWithCtx: vi.fn(),
}));

function buildSession() {
  return {
    _id: "session-1" as Id<"registerSession">,
    storeId: "store-1" as Id<"store">,
    organizationId: "org-1" as Id<"organization">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    registerNumber: "A1",
    status: "open" as const,
    openedAt: 111,
    openingFloat: 5_000,
    expectedCash: 5_000,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordRegisterSessionTraceBestEffort", () => {
  it("records an opened register-session trace using openedAt for bootstrap ordering", async () => {
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    const result = await recordRegisterSessionTraceBestEffort({} as never, {
      stage: "opened",
      session: buildSession(),
    });

    expect(result).toEqual({
      traceCreated: true,
      traceId: "register_session:session-1",
    });
    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        startedAt: 111,
        status: "started",
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        occurredAt: 111,
        step: "register_session_opened",
        status: "started",
      }),
    );
  });

  it("marks approval-pending closeouts as blocked without completing the trace", async () => {
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    await recordRegisterSessionTraceBestEffort({} as never, {
      stage: "approval_pending",
      session: {
        ...buildSession(),
        countedCash: 16_050,
        expectedCash: 10_000,
        status: "closing" as const,
      },
      occurredAt: 222,
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      variance: 6_050,
    });

    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "blocked",
        completedAt: undefined,
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        occurredAt: 222,
        step: "register_session_approval_pending",
        status: "blocked",
      }),
    );
  });

  it("uses the current time for non-open milestones when no occurredAt is provided", async () => {
    vi.spyOn(Date, "now").mockReturnValue(444);
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    await recordRegisterSessionTraceBestEffort({} as never, {
      stage: "deposit_recorded",
      session: buildSession(),
      amount: 2_500,
    });

    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        occurredAt: 444,
        step: "register_session_deposit_recorded",
      }),
    );
  });

  it("reports traceCreated false when the trace row write fails", async () => {
    vi.mocked(createWorkflowTraceWithCtx).mockRejectedValue(
      new Error("trace unavailable"),
    );
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    const result = await recordRegisterSessionTraceBestEffort({} as never, {
      stage: "deposit_recorded",
      session: buildSession(),
      amount: 2_500,
      occurredAt: 333,
    });

    expect(result).toEqual({
      traceCreated: false,
      traceId: "register_session:session-1",
    });
  });
});

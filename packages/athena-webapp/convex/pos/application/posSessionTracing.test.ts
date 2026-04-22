import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import { buildPosSessionTraceSeed } from "../../workflowTraces/adapters/posSession";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../../workflowTraces/core";
import { recordPosSessionTraceBestEffort } from "./commands/posSessionTracing";

vi.mock("../../workflowTraces/core", () => ({
  appendWorkflowTraceEventWithCtx: vi.fn(),
  createWorkflowTraceWithCtx: vi.fn(),
  registerWorkflowTraceLookupWithCtx: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("recordPosSessionTraceBestEffort", () => {
  it("uses the seed startedAt for session-start ordering", async () => {
    const traceSeed = buildPosSessionTraceSeed({
      storeId: "store-1" as Id<"store">,
      startedAt: 111,
      sessionNumber: "SES-001",
      posSessionId: "session-1" as Id<"posSession">,
      cashierId: "cashier-1" as Id<"cashier">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    await recordPosSessionTraceBestEffort({} as never, {
      stage: "started",
      traceSeed,
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
        step: "session_started",
        status: "started",
      }),
    );
  });

  it("marks completed session traces as succeeded and links the transaction", async () => {
    const traceSeed = buildPosSessionTraceSeed({
      storeId: "store-1" as Id<"store">,
      startedAt: 111,
      sessionNumber: "SES-001",
      posSessionId: "session-1" as Id<"posSession">,
      cashierId: "cashier-1" as Id<"cashier">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      posTransactionId: "txn-1" as Id<"posTransaction">,
    });

    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    const result = await recordPosSessionTraceBestEffort({} as never, {
      stage: "completed",
      traceSeed,
      occurredAt: 222,
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(result).toEqual({
      traceCreated: true,
      traceId: traceSeed.trace.traceId,
    });
    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        startedAt: 111,
        status: "succeeded",
        completedAt: 222,
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        occurredAt: 222,
        step: "session_completed",
        status: "succeeded",
        details: expect.objectContaining({
          transactionId: "txn-1",
        }),
      }),
    );
  });

  it("marks expired session traces as failed without breaking the lifecycle write", async () => {
    const traceSeed = buildPosSessionTraceSeed({
      storeId: "store-1" as Id<"store">,
      startedAt: 111,
      sessionNumber: "SES-001",
      posSessionId: "session-1" as Id<"posSession">,
      cashierId: "cashier-1" as Id<"cashier">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    await recordPosSessionTraceBestEffort({} as never, {
      stage: "expired",
      traceSeed,
      occurredAt: 333,
    });

    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        health: "partial",
        completedAt: 333,
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        occurredAt: 333,
        step: "session_expired",
        status: "failed",
      }),
    );
  });

  it("reports traceCreated false when the trace row write fails", async () => {
    const traceSeed = buildPosSessionTraceSeed({
      storeId: "store-1" as Id<"store">,
      sessionNumber: "SES-001",
      posSessionId: "session-1" as Id<"posSession">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    vi.mocked(createWorkflowTraceWithCtx).mockRejectedValue(
      new Error("trace unavailable"),
    );
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    const result = await recordPosSessionTraceBestEffort({} as never, {
      stage: "started",
      traceSeed,
    });

    expect(result).toEqual({
      traceCreated: false,
      traceId: traceSeed.trace.traceId,
    });
  });
});

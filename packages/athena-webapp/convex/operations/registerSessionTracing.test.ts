import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../workflowTraces/core";
import { toDisplayAmount } from "../lib/currency";
import { currencyFormatter } from "../utils";

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

function buildCtx(currency = "GHS") {
  const getStore = vi.fn().mockResolvedValue({ currency });

  return {
    ctx: { db: { get: getStore } } as never,
    getStore,
  };
}

function formatStoredTraceAmount(currency: string, amount: number) {
  return currencyFormatter(currency).format(toDisplayAmount(amount));
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordRegisterSessionTraceBestEffort", () => {
  const moneyMovementCases = [
    {
      amount: 12_345,
      message: `Recorded sale cash movement of ${formatStoredTraceAmount("GHS", 12_345)}.`,
      stage: "sale_recorded" as const,
      step: "register_session_sale_recorded",
    },
    {
      amount: 6_789,
      message: `Recorded void cash adjustment of ${formatStoredTraceAmount("GHS", 6_789)}.`,
      stage: "void_recorded" as const,
      step: "register_session_void_recorded",
    },
    {
      amount: 250_000,
      message: `Recorded cash deposit of ${formatStoredTraceAmount("GHS", 250_000)}.`,
      stage: "deposit_recorded" as const,
      step: "register_session_deposit_recorded",
    },
  ];

  it.each(moneyMovementCases)(
    "formats stored minor-unit amounts in the $stage trace message while preserving details.amount",
    async ({ amount, message, stage, step }) => {
      vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue(
        "trace-1" as never,
      );
      vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
        "lookup-1" as never,
      );
      vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
        "event-1" as never,
      );
      const { ctx } = buildCtx();

      await recordRegisterSessionTraceBestEffort(ctx, {
        stage,
        session: buildSession(),
        amount,
        occurredAt: 222,
      });

      expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          details: expect.objectContaining({ amount }),
          message,
          occurredAt: 222,
          step,
        }),
      );
    },
  );

  it("uses a display-zero fallback in cash movement trace messages when amount is missing", async () => {
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );
    const { ctx } = buildCtx();

    await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "sale_recorded",
      session: buildSession(),
      occurredAt: 222,
    });

    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        details: expect.not.objectContaining({ amount: expect.anything() }),
        message: `Recorded sale cash movement of ${currencyFormatter("GHS").format(0)}.`,
        occurredAt: 222,
        step: "register_session_sale_recorded",
      }),
    );
  });

  it("uses the register session store currency when formatting trace money", async () => {
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );
    const { ctx, getStore } = buildCtx("USD");

    await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "sale_recorded",
      session: buildSession(),
      amount: 12_345,
      occurredAt: 222,
    });

    expect(getStore).toHaveBeenCalledWith("store", "store-1");
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        details: expect.objectContaining({ amount: 12_345 }),
        message: `Recorded sale cash movement of ${formatStoredTraceAmount("USD", 12_345)}.`,
        occurredAt: 222,
        step: "register_session_sale_recorded",
      }),
    );
  });

  it("falls back to GHS when the store currency is invalid", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );
    const { ctx } = buildCtx("not-a-currency");

    await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "sale_recorded",
      session: buildSession(),
      amount: 12_345,
      occurredAt: 222,
    });

    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        details: expect.objectContaining({ amount: 12_345 }),
        message: `Recorded sale cash movement of ${formatStoredTraceAmount("GHS", 12_345)}.`,
        occurredAt: 222,
        step: "register_session_sale_recorded",
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[workflow-trace] register.session.trace.currency-format",
      expect.objectContaining({
        currency: "not-a-currency",
        error: expect.any(RangeError),
      }),
    );
  });

  it("records an opened register-session trace using openedAt for bootstrap ordering", async () => {
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );
    const { ctx } = buildCtx();

    const result = await recordRegisterSessionTraceBestEffort(ctx, {
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
    const { ctx } = buildCtx();

    await recordRegisterSessionTraceBestEffort(ctx, {
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
    const { ctx } = buildCtx();

    await recordRegisterSessionTraceBestEffort(ctx, {
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
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(createWorkflowTraceWithCtx).mockRejectedValue(
      new Error("trace unavailable"),
    );
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );
    const { ctx } = buildCtx();

    const result = await recordRegisterSessionTraceBestEffort(ctx, {
      stage: "deposit_recorded",
      session: buildSession(),
      amount: 2_500,
      occurredAt: 333,
    });

    expect(result).toEqual({
      traceCreated: false,
      traceId: "register_session:session-1",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[workflow-trace] register.session.trace.create",
      expect.any(Error),
    );
  });
});

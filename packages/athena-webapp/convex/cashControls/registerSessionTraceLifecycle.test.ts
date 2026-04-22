import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";

const mocks = vi.hoisted(() => ({
  recordOperationalEventWithCtx: vi.fn(),
  recordPaymentAllocationWithCtx: vi.fn(),
  recordRegisterSessionDepositWithCtx: vi.fn(),
  traceRecord: vi.fn(),
}));

vi.mock("../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: mocks.recordOperationalEventWithCtx,
}));

vi.mock("../operations/paymentAllocations", () => ({
  recordPaymentAllocationWithCtx: mocks.recordPaymentAllocationWithCtx,
}));

vi.mock("../operations/registerSessions", async () => {
  const actual = await vi.importActual("../operations/registerSessions");

  return {
    ...(actual as object),
    recordRegisterSessionDepositWithCtx: mocks.recordRegisterSessionDepositWithCtx,
  };
});

vi.mock("../operations/registerSessionTracing", () => ({
  recordRegisterSessionTraceBestEffort: mocks.traceRecord,
}));

import {
  recordRegisterSessionDeposit,
} from "./deposits";
import {
  reviewRegisterSessionCloseout,
  submitRegisterSessionCloseout,
} from "./closeouts";

type RegisterSessionRecord = {
  _id: Id<"registerSession">;
  closedAt?: number;
  countedCash?: number;
  expectedCash: number;
  managerApprovalRequestId?: Id<"approvalRequest">;
  openedAt: number;
  organizationId?: Id<"organization">;
  registerNumber?: string;
  status: "open" | "active" | "closing" | "closed";
  storeId: Id<"store">;
  terminalId?: Id<"posTerminal">;
  workflowTraceId?: string;
};

type ApprovalRequestRecord = {
  _id: Id<"approvalRequest">;
  createdAt: number;
  registerSessionId?: Id<"registerSession">;
  requestType: "variance_review";
  status: "pending" | "approved" | "rejected" | "cancelled";
};

function buildRegisterSession(
  overrides?: Partial<RegisterSessionRecord>,
): RegisterSessionRecord {
  return {
    _id: "session-1" as Id<"registerSession">,
    expectedCash: 10_000,
    openedAt: 111,
    organizationId: "org-1" as Id<"organization">,
    registerNumber: "A1",
    status: "active",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    ...overrides,
  };
}

function createMutationCtx(seed?: {
  approvalRequests?: ApprovalRequestRecord[];
  registerSessions?: RegisterSessionRecord[];
}) {
  const approvalRequests = [...(seed?.approvalRequests ?? [])];
  const registerSessions = [...(seed?.registerSessions ?? [])];

  const db = {
    get: vi.fn(async (table: string, id: string) => {
      if (table === "registerSession") {
        return registerSessions.find((session) => session._id === id) ?? null;
      }

      if (table === "approvalRequest") {
        return approvalRequests.find((request) => request._id === id) ?? null;
      }

      return null;
    }),
    insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table !== "approvalRequest") {
        throw new Error(`Unsupported insert into ${table}`);
      }

      const request = {
        _id: `approval-${approvalRequests.length + 1}` as Id<"approvalRequest">,
        createdAt: 222,
        status: "pending" as const,
        requestType: "variance_review" as const,
        ...value,
      };
      approvalRequests.push(request);
      return request._id;
    }),
    patch: vi.fn(async (table: string, id: string, patch: Record<string, unknown>) => {
      if (table !== "registerSession") {
        return;
      }

      const session = registerSessions.find((entry) => entry._id === id);
      if (!session) {
        return;
      }

      Object.assign(session, patch);
    }),
    query: vi.fn((table: string) => ({
      withIndex(indexName: string, apply: (builder: {
        eq(field: string, value: unknown): unknown;
      }) => void) {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq(field: string, value: unknown) {
            filters[field] = value;
            return builder;
          },
        };

        apply(builder);

        if (
          table === "paymentAllocation" &&
          indexName === "by_storeId_target"
        ) {
          return {
            first: async () => null,
          };
        }

        throw new Error(`Unsupported query ${table}.${indexName}`);
      },
    })),
  };

  const runMutation = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
    if ("countedCash" in args && "registerSessionId" in args && !("decision" in args)) {
      const session = registerSessions.find(
        (entry) => entry._id === args.registerSessionId,
      );

      if (!session) {
        return null;
      }

      Object.assign(session, {
        countedCash: args.countedCash,
        notes: args.notes,
        status: session.status === "closing" ? "closed" : "closing",
        ...(session.status === "closing" ? { closedAt: 333 } : {}),
      });
      return session;
    }

    if ("decision" in args) {
      const request = approvalRequests.find(
        (entry) => entry._id === args.approvalRequestId,
      );

      if (!request) {
        return null;
      }

      request.status = args.decision === "approved" ? "approved" : "rejected";
      return request;
    }

    return null;
  });

  const runQuery = vi.fn(async () => ({
    config: {
      operations: {
        cashControls: {
          varianceApprovalThreshold: 5_000,
        },
      },
    },
  }));

  return {
    db,
    runMutation,
    runQuery,
    registerSessions,
  };
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("register session trace lifecycle handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(999);
    mocks.recordPaymentAllocationWithCtx.mockResolvedValue({
      _id: "allocation-1",
    });
    mocks.recordRegisterSessionDepositWithCtx.mockImplementation(
      async (_ctx: unknown, args: { amount: number; registerSessionId: Id<"registerSession"> }) =>
        buildRegisterSession({
          _id: args.registerSessionId,
          expectedCash: 7_500,
        }),
    );
    mocks.traceRecord.mockResolvedValue({
      traceCreated: true,
      traceId: "register_session:session-1",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records a deposit trace and persists the workflowTraceId", async () => {
    const ctx = createMutationCtx({
      registerSessions: [buildRegisterSession()],
    });

    const result = await getHandler(recordRegisterSessionDeposit)(ctx as never, {
      actorStaffProfileId: "staff-1",
      amount: 2_500,
      notes: "Safe drop",
      reference: "SAFE-1",
      registerSessionId: "session-1",
      storeId: "store-1",
      submissionKey: "deposit-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "recorded",
      }),
    );
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stage: "deposit_recorded",
        occurredAt: 999,
        amount: 2_500,
        session: expect.objectContaining({
          _id: "session-1",
        }),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("registerSession", "session-1", {
      workflowTraceId: "register_session:session-1",
    });
  });

  it("does not persist the register-session trace link for deposits when trace creation fails", async () => {
    mocks.traceRecord.mockResolvedValueOnce({
      traceCreated: false,
      traceId: "register_session:session-1",
    });
    const ctx = createMutationCtx({
      registerSessions: [buildRegisterSession()],
    });

    await getHandler(recordRegisterSessionDeposit)(ctx as never, {
      actorStaffProfileId: "staff-1",
      amount: 2_500,
      notes: "Safe drop",
      reference: "SAFE-1",
      registerSessionId: "session-1",
      storeId: "store-1",
      submissionKey: "deposit-1",
    });

    expect(ctx.db.patch).not.toHaveBeenCalledWith("registerSession", "session-1", {
      workflowTraceId: "register_session:session-1",
    });
  });

  it("records closeout submission and approval-pending trace milestones", async () => {
    const ctx = createMutationCtx({
      registerSessions: [buildRegisterSession()],
    });

    const result = await getHandler(submitRegisterSessionCloseout)(ctx as never, {
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      countedCash: 16_050,
      notes: "Variance requires review",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "approval_required",
      }),
    );
    expect(mocks.traceRecord).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        stage: "closeout_submitted",
        occurredAt: 999,
      }),
    );
    expect(mocks.traceRecord).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        stage: "approval_pending",
        occurredAt: 999,
        approvalRequestId: "approval-1",
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("registerSession", "session-1", {
      workflowTraceId: "register_session:session-1",
    });
  });

  it("does not persist the register-session trace link for closeouts when trace creation fails", async () => {
    mocks.traceRecord
      .mockResolvedValueOnce({
        traceCreated: false,
        traceId: "register_session:session-1",
      })
      .mockResolvedValueOnce({
        traceCreated: false,
        traceId: "register_session:session-1",
      });
    const ctx = createMutationCtx({
      registerSessions: [buildRegisterSession()],
    });

    await getHandler(submitRegisterSessionCloseout)(ctx as never, {
      actorStaffProfileId: "staff-1",
      actorUserId: "user-1",
      countedCash: 16_050,
      notes: "Variance requires review",
      registerSessionId: "session-1",
      storeId: "store-1",
    });

    expect(ctx.db.patch).not.toHaveBeenCalledWith("registerSession", "session-1", {
      workflowTraceId: "register_session:session-1",
    });
  });

  it("records approval and final closed trace milestones after manager approval", async () => {
    const ctx = createMutationCtx({
      approvalRequests: [
        {
          _id: "approval-1" as Id<"approvalRequest">,
          createdAt: 222,
          registerSessionId: "session-1" as Id<"registerSession">,
          requestType: "variance_review",
          status: "pending",
        },
      ],
      registerSessions: [
        buildRegisterSession({
          countedCash: 16_050,
          managerApprovalRequestId: "approval-1" as Id<"approvalRequest">,
          status: "closing",
        }),
      ],
    });

    const result = await getHandler(reviewRegisterSessionCloseout)(ctx as never, {
      decision: "approved",
      decisionNotes: "Approved after recount",
      registerSessionId: "session-1",
      reviewedByStaffProfileId: "staff-2",
      reviewedByUserId: "user-2",
      storeId: "store-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "approved",
      }),
    );
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stage: "closeout_approved",
        occurredAt: 333,
        approvalRequestId: "approval-1",
        session: expect.objectContaining({
          _id: "session-1",
        }),
      }),
    );
    expect(mocks.traceRecord).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        stage: "closed",
        occurredAt: 333,
        session: expect.objectContaining({
          _id: "session-1",
          closedAt: 333,
        }),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("registerSession", "session-1", {
      workflowTraceId: "register_session:session-1",
    });
  });

  it("records a rejected closeout trace milestone when manager review fails", async () => {
    const ctx = createMutationCtx({
      approvalRequests: [
        {
          _id: "approval-1" as Id<"approvalRequest">,
          createdAt: 222,
          registerSessionId: "session-1" as Id<"registerSession">,
          requestType: "variance_review",
          status: "pending",
        },
      ],
      registerSessions: [
        buildRegisterSession({
          countedCash: 16_050,
          managerApprovalRequestId: "approval-1" as Id<"approvalRequest">,
          status: "closing",
        }),
      ],
    });

    const result = await getHandler(reviewRegisterSessionCloseout)(ctx as never, {
      decision: "rejected",
      decisionNotes: "Recount required",
      registerSessionId: "session-1",
      reviewedByStaffProfileId: "staff-2",
      reviewedByUserId: "user-2",
      storeId: "store-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "rejected",
      }),
    );
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stage: "closeout_rejected",
        occurredAt: 999,
        approvalRequestId: "approval-1",
      }),
    );
  });
});

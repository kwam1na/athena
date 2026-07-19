import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import {
  createRegisterSessionActivityIngestionService,
  type RegisterSessionActivityIngestionRepository,
  type RegisterSessionActivityRecord,
} from "./posRegisterSessionActivity";

describe("createRegisterSessionActivityIngestionService", () => {
  it("upserts activity idempotently by terminal local event id", async () => {
    const repository = createFakeRepository({
      registerSessionMapping: "register-session-1" as Id<"registerSession">,
    });
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });
    const report = buildReport();

    const first = await service.ingestReport(report);
    const second = await service.ingestReport(report);

    expect(first.kind).toBe("ok");
    expect(second).toEqual(first);
    expect(repository.activities).toHaveLength(1);
    expect(repository.activities[0]).toMatchObject({
      activityKey: "local:store-1:terminal-1:event-1",
      localEventId: "event-1",
      registerSessionId: "register-session-1",
      staffProfileId: "staff-1",
      status: "terminal_reported",
    });
  });

  it("drops staff attribution when the staff profile is not active in the activity store", async () => {
    const repository = createFakeRepository({
      staffStoreId: "store-2",
    });
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });

    const result = await service.ingestReport(buildReport());

    expect(result.kind).toBe("ok");
    expect(repository.activities[0]).toMatchObject({
      localEventId: "event-1",
      staffProfileId: undefined,
    });
  });

  it("persists mapping-pending rows without fabricating a cloud register session id", async () => {
    const repository = createFakeRepository();
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });

    const result = await service.ingestReport(buildReport());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      {
        localEventId: "event-1",
        sequence: 1,
        status: "mapping_pending",
      },
    ]);
    expect(repository.activities).toEqual([
      expect.objectContaining({
        localEventId: "event-1",
        registerSessionId: undefined,
        status: "mapping_pending",
      }),
    ]);
  });

  it("binds activity when the local register-session id is already a cloud id", async () => {
    const repository = createFakeRepository();
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });

    const result = await service.ingestReport(
      buildReport({ localRegisterSessionId: "register-session-1" }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([
      {
        localEventId: "event-1",
        sequence: 1,
        status: "terminal_reported",
      },
    ]);
    expect(repository.activities[0]).toMatchObject({
      localRegisterSessionId: "register-session-1",
      registerSessionId: "register-session-1",
      status: "terminal_reported",
    });
    expect(repository.checkpoints[0]).toMatchObject({
      localRegisterSessionId: "register-session-1",
      registerSessionId: "register-session-1",
    });
  });

  it("resolves existing mapping-pending rows after a register-session mapping appears", async () => {
    const repository = createFakeRepository();
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });
    await service.ingestReport(buildReport());

    repository.registerSessionMapping =
      "register-session-1" as Id<"registerSession">;
    const resolved = await service.resolveMappingPending({
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      localRegisterSessionId: "local-register-1",
    });

    expect(resolved).toEqual({ hasMore: false, resolved: 1 });
    expect(repository.activities[0]).toMatchObject({
      registerSessionId: "register-session-1",
      status: "projected",
    });
  });

  it("does not scan mapping-pending backlog on the mapping-bound report hot path", async () => {
    const repository = createFakeRepository();
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });
    await service.ingestReport(buildReport());
    repository.registerSessionMapping =
      "register-session-1" as Id<"registerSession">;
    repository.mappingPendingListCalls = 0;

    await service.ingestReport(
      buildReport({
        activities: [buildActivity({ localEventId: "event-2", sequence: 2 })],
        reportedThroughSequence: 2,
      }),
    );

    expect(repository.mappingPendingListCalls).toBe(0);
    expect(repository.activities).toEqual([
      expect.objectContaining({
        localEventId: "event-1",
        status: "mapping_pending",
      }),
      expect.objectContaining({
        localEventId: "event-2",
        status: "terminal_reported",
      }),
    ]);
  });

  it("reconciles a bounded batch and checkpoints an explicit continuation", async () => {
    const repository = createFakeRepository();
    const scheduleMappingPendingContinuation = vi.fn(async () => null);
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
      scheduleMappingPendingContinuation,
    });
    await service.ingestReport(
      buildReport({
        activities: Array.from({ length: 205 }, (_, index) =>
          buildActivity({
            localEventId: `event-${index + 1}`,
            sequence: index + 1,
          }),
        ),
        reportedThroughSequence: 205,
      }),
    );
    repository.registerSessionMapping =
      "register-session-1" as Id<"registerSession">;

    await expect(
      service.resolveMappingPending({
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        localRegisterSessionId: "local-register-1",
      }),
    ).resolves.toEqual({ hasMore: true, resolved: 100 });
    expect(repository.mappingPendingListCalls).toBe(1);
    expect(
      repository.activities.filter((activity) =>
        activity.status === "mapping_pending"),
    ).toHaveLength(105);
    expect(repository.checkpoints[0]).toMatchObject({
      mappingReconciliationPending: true,
      registerSessionId: "register-session-1",
    });
    expect(scheduleMappingPendingContinuation).toHaveBeenCalledOnce();

    await service.resolveMappingPending({
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      localRegisterSessionId: "local-register-1",
    });
    await expect(
      service.resolveMappingPending({
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        localRegisterSessionId: "local-register-1",
      }),
    ).resolves.toEqual({ hasMore: false, resolved: 5 });
    expect(repository.checkpoints[0]).toMatchObject({
      mappingReconciliationPending: false,
    });
  });

  it("recovers existing mapping-pending rows when a direct cloud binding becomes recognizable", async () => {
    const repository = createFakeRepository();
    repository.directRegisterSessionResolutionEnabled = false;
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });
    await service.ingestReport(
      buildReport({ localRegisterSessionId: "register-session-1" }),
    );

    repository.directRegisterSessionResolutionEnabled = true;
    const result = await service.ingestReport(
      buildReport({
        activities: [buildActivity({ localEventId: "event-2", sequence: 2 })],
        localRegisterSessionId: "register-session-1",
        reportedThroughSequence: 2,
      }),
    );

    expect(result.kind).toBe("ok");
    expect(repository.activities).toEqual([
      expect.objectContaining({
        localEventId: "event-1",
        registerSessionId: "register-session-1",
        status: "projected",
      }),
      expect.objectContaining({
        localEventId: "event-2",
        registerSessionId: "register-session-1",
        status: "terminal_reported",
      }),
    ]);
    expect(repository.checkpoints[0]).toMatchObject({
      registerSessionId: "register-session-1",
      reportedThroughSequence: 2,
    });
  });

  it("updates the checkpoint for empty and sanitizer-skipped reports", async () => {
    const repository = createFakeRepository();
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });

    const result = await service.ingestReport(
      buildReport({
        activities: [
          buildActivity({
            localEventId: "event-bad",
            metadata: { staffProofToken: "do-not-store" },
            sequence: 4,
          }),
        ],
        reportedThroughSequence: 4,
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.accepted).toEqual([]);
    expect(result.data.skipped).toEqual([
      {
        localEventId: "event-bad",
        sequence: 4,
        code: "disallowed_metadata",
      },
    ]);
    expect(result.data.checkpoint).toMatchObject({
      reportedThroughSequence: 4,
      skippedCounts: {
        disallowed_metadata: 1,
      },
    });
    expect(repository.activities).toHaveLength(0);

    const empty = await service.ingestReport(
      buildReport({
        activities: [],
        reportedThroughSequence: 5,
      }),
    );

    expect(empty.kind).toBe("ok");
    if (empty.kind !== "ok") throw new Error("Expected ok result");
    expect(empty.data.checkpoint).toMatchObject({
      reportedThroughSequence: 5,
      skippedCounts: {
        disallowed_metadata: 1,
      },
    });

    const retry = await service.ingestReport(
      buildReport({
        activities: [
          buildActivity({
            localEventId: "event-bad",
            metadata: { staffProofToken: "do-not-store" },
            sequence: 4,
          }),
        ],
        reportedThroughSequence: 6,
      }),
    );

    expect(retry.kind).toBe("ok");
    if (retry.kind !== "ok") throw new Error("Expected ok result");
    expect(retry.data.checkpoint).toMatchObject({
      reportedThroughSequence: 6,
      skippedCounts: {
        disallowed_metadata: 1,
      },
    });
  });

  it("rejects unsafe string metadata even for allowed keys", async () => {
    const repository = createFakeRepository();
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });

    const result = await service.ingestReport(
      buildReport({
        activities: [
          buildActivity({
            metadata: {
              itemCount: 1,
              receiptNumber: '{"customerEmail":"bad@example.com"}',
            },
          }),
        ],
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected ok result");
    expect(result.data.skipped).toEqual([
      {
        localEventId: "event-1",
        sequence: 1,
        code: "invalid_metadata",
      },
    ]);
    expect(repository.activities).toHaveLength(0);
  });

  it("rejects activity from a terminal that is not bound to the store", async () => {
    const repository = createFakeRepository({ terminalStoreId: "store-2" });
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });

    const result = await service.ingestReport(buildReport());

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
      },
    });
    expect(repository.activities).toHaveLength(0);
  });

  it("rejects mapped activity when the register-session binding belongs to another terminal", async () => {
    const repository = createFakeRepository({
      registerSessionMapping: "register-session-1" as Id<"registerSession">,
      registerSessionTerminalId: "terminal-2" as Id<"posTerminal">,
    });
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });

    const result = await service.ingestReport(buildReport());

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "POS activity report is not bound to this terminal session.",
      },
    });
    expect(repository.activities).toHaveLength(0);
  });

  it("rejects direct cloud activity when the register-session binding belongs to another terminal", async () => {
    const repository = createFakeRepository({
      registerSessionTerminalId: "terminal-2" as Id<"posTerminal">,
    });
    const service = createRegisterSessionActivityIngestionService({
      now: () => 200,
      repository,
    });

    const result = await service.ingestReport(
      buildReport({ localRegisterSessionId: "register-session-1" }),
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "POS activity report is not bound to this terminal session.",
      },
    });
    expect(repository.activities).toHaveLength(0);
  });
});

function buildReport(
  overrides: Partial<
    Parameters<
      ReturnType<
        typeof createRegisterSessionActivityIngestionService
      >["ingestReport"]
    >[0]
  > = {},
) {
  return {
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    localRegisterSessionId: "local-register-1",
    registerNumber: "R1",
    reportedThroughSequence: 1,
    submittedAt: 150,
    activities: [buildActivity()],
    ...overrides,
  };
}

function buildActivity(overrides: Record<string, unknown> = {}) {
  return {
    localEventId: "event-1",
    sequence: 1,
    uploadSequence: 10,
    occurredAt: 100,
    staffProfileId: "staff-1" as Id<"staffProfile">,
    eventType: "sale_completed",
    category: "sale",
    metadata: {
      itemCount: 2,
      paymentCount: 1,
      receiptNumber: "R-100",
      totalAmount: 5000,
    },
    ...overrides,
  } as never;
}

function createFakeRepository(
  options: {
    registerSessionMapping?: Id<"registerSession">;
    registerSessionTerminalId?: Id<"posTerminal">;
    staffStoreId?: string;
    terminalStoreId?: string;
  } = {},
) {
  const activities: RegisterSessionActivityRecord[] = [];
  const checkpoints: NonNullable<
    Awaited<
      ReturnType<RegisterSessionActivityIngestionRepository["findCheckpoint"]>
    >
  >[] = [];
  const repository: RegisterSessionActivityIngestionRepository & {
    activities: RegisterSessionActivityRecord[];
    checkpoints: typeof checkpoints;
    directRegisterSessionResolutionEnabled: boolean;
    mappingPendingListCalls: number;
    registerSessionMapping?: Id<"registerSession">;
  } = {
    activities,
    checkpoints,
    directRegisterSessionResolutionEnabled: true,
    mappingPendingListCalls: 0,
    registerSessionMapping: options.registerSessionMapping,
    async getTerminal(terminalId) {
      if (terminalId !== "terminal-1") return null;
      return {
        _id: "terminal-1" as Id<"posTerminal">,
        storeId: (options.terminalStoreId ?? "store-1") as Id<"store">,
        registerNumber: "R1",
        status: "active",
      };
    },
    async getRegisterSession(registerSessionId) {
      if (registerSessionId !== "register-session-1") return null;
      return {
        _id: "register-session-1" as Id<"registerSession">,
        storeId: "store-1" as Id<"store">,
        terminalId:
          options.registerSessionTerminalId ??
          ("terminal-1" as Id<"posTerminal">),
        registerNumber: "R1",
      };
    },
    normalizeRegisterSessionId(value) {
      return repository.directRegisterSessionResolutionEnabled &&
        value === "register-session-1"
        ? (value as Id<"registerSession">)
        : null;
    },
    async getStaffProfile(staffProfileId) {
      if (staffProfileId !== "staff-1") return null;
      return {
        _id: "staff-1" as Id<"staffProfile">,
        storeId: (options.staffStoreId ?? "store-1") as Id<"store">,
        status: "active",
      };
    },
    async findRegisterSessionMapping() {
      return repository.registerSessionMapping
        ? {
            registerSessionId: repository.registerSessionMapping,
          }
        : null;
    },
    async findActivityByLocalEvent(args) {
      return (
        activities.find(
          (activity) =>
            activity.storeId === args.storeId &&
            activity.terminalId === args.terminalId &&
            activity.localEventId === args.localEventId,
        ) ?? null
      );
    },
    async createActivity(input) {
      const activity = {
        _creationTime: 1,
        _id: `activity-${activities.length + 1}` as Id<"posRegisterSessionActivity">,
        ...input,
      };
      activities.push(activity);
      return activity;
    },
    async patchActivity(activityId, patch) {
      const activity = activities.find((entry) => entry._id === activityId);
      if (!activity) throw new Error(`Missing activity ${activityId}`);
      Object.assign(activity, patch);
    },
    async listMappingPendingActivity(args) {
      repository.mappingPendingListCalls += 1;
      return activities
        .filter(
          (activity) =>
            activity.storeId === args.storeId &&
            activity.terminalId === args.terminalId &&
            activity.localRegisterSessionId === args.localRegisterSessionId &&
            activity.status === "mapping_pending",
        )
        .slice(0, args.limit);
    },
    async findSyncEventByLocalEvent(args) {
      return {
        _id: `sync-${args.localEventId}` as Id<"posLocalSyncEvent">,
        status: "projected",
      };
    },
    async findCheckpoint(args) {
      return (
        checkpoints.find(
          (checkpoint) =>
            checkpoint.storeId === args.storeId &&
            checkpoint.terminalId === args.terminalId &&
            checkpoint.localRegisterSessionId === args.localRegisterSessionId,
        ) ?? null
      );
    },
    async createCheckpoint(input) {
      const checkpoint = {
        _creationTime: 1,
        _id: `checkpoint-${checkpoints.length + 1}` as Id<"posRegisterSessionActivityCheckpoint">,
        ...input,
      };
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    async patchCheckpoint(checkpointId, patch) {
      const checkpoint = checkpoints.find((entry) => entry._id === checkpointId);
      if (!checkpoint) throw new Error(`Missing checkpoint ${checkpointId}`);
      Object.assign(checkpoint, patch);
    },
  };

  return repository;
}

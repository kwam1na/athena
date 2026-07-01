import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import {
  buildTerminalCloudRepairPreview,
  canProjectRegisterOpenForTerminalCloudRepair,
  classifyTerminalCloudRepairConflict,
} from "./cloudRepairPolicy";
import type { TerminalCloudRepairProjectionEligibilityRepository } from "./cloudRepairPolicy";

const now = 1_000_000;
const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;

describe("terminal cloud repair policy", () => {
  it("allows stale duplicate register-open conflicts when the source event is lifecycle-only", () => {
    const conflict = buildConflict({
      conflictType: "duplicate_local_id",
      details: {
        duplicateOfLocalEventId: "event-accepted-open",
        reason: "duplicate_register_opened",
      },
      summary: "Duplicate register-open attempt for an already opened drawer.",
    });
    const sourceEvent = buildEvent({ eventType: "register_opened" });

    expect(
      classifyTerminalCloudRepairConflict({
        conflict,
        now,
        sourceEvent,
        storeId,
        terminalId,
      }),
    ).toEqual({
      conflictId: conflict._id,
      kind: "safe_duplicate_register_opened",
      localEventId: "event-1",
      localRegisterSessionId: "register-1",
      sequence: 1,
    });
  });

  it("skips sale, payment, inventory, closeout, and variance facts", () => {
    const forbiddenInputs = [
      buildConflict({
        details: { paymentId: "payment-1", reason: "duplicate_register_opened" },
      }),
      buildConflict({
        details: { inventoryMovementId: "movement-1", reason: "duplicate_register_opened" },
      }),
      buildConflict({
        details: { closeoutVariance: 5, reason: "duplicate_register_opened" },
      }),
      buildConflict({
        details: { varianceAmount: 5, reason: "duplicate_register_opened" },
      }),
    ];

    for (const conflict of forbiddenInputs) {
      expect(
        classifyTerminalCloudRepairConflict({
          conflict,
          now,
          sourceEvent: buildEvent({ eventType: "register_opened" }),
          storeId,
          terminalId,
        }),
      ).toMatchObject({
        conflictId: conflict._id,
        kind: "skipped",
        reason: "contains_business_facts",
      });
    }

    expect(
      classifyTerminalCloudRepairConflict({
        conflict: buildConflict({
          details: { reason: "duplicate_register_opened" },
        }),
        now,
        sourceEvent: buildEvent({ eventType: "sale_completed" }),
        storeId,
        terminalId,
      }),
    ).toMatchObject({
      kind: "skipped",
      reason: "not_register_opened",
    });
  });

  it("skips source events that carry unsafe business facts", () => {
    const conflict = buildConflict();

    expect(
      classifyTerminalCloudRepairConflict({
        conflict,
        now,
        sourceEvent: buildEvent({
          payload: {
            openingFloat: 100,
            registerNumber: "A1",
            sale: {
              saleId: "sale-1",
              total: 25,
            },
          },
        }),
        storeId,
        terminalId,
      }),
    ).toMatchObject({
      conflictId: conflict._id,
      kind: "skipped",
      reason: "contains_business_facts",
    });
  });

  it("skips missing source events and already-resolved conflicts", () => {
    expect(
      classifyTerminalCloudRepairConflict({
        conflict: buildConflict(),
        now,
        sourceEvent: null,
        storeId,
        terminalId,
      }),
    ).toMatchObject({
      kind: "skipped",
      reason: "missing_source_event",
    });

    expect(
      classifyTerminalCloudRepairConflict({
        conflict: buildConflict({
          _id: "resolved-conflict" as Id<"posLocalSyncConflict">,
          status: "resolved",
        }),
        now,
        sourceEvent: buildEvent({ eventType: "register_opened" }),
        storeId,
        terminalId,
      }),
    ).toMatchObject({
      conflictId: "resolved-conflict",
      kind: "skipped",
      reason: "not_needs_review",
    });
  });

  it("requires preview preconditions to match before repair runs", () => {
    const safeConflict = buildConflict();
    const preview = buildTerminalCloudRepairPreview({
      classified: [
        classifyTerminalCloudRepairConflict({
          conflict: safeConflict,
          now,
          sourceEvent: buildEvent({ eventType: "register_opened" }),
          storeId,
          terminalId,
        }),
      ],
      storeId,
      terminalId,
    });

    expect(preview.preconditionHash).toMatch(/^terminal-cloud-repair:/);
    expect(
      buildTerminalCloudRepairPreview({
        classified: [],
        storeId,
        terminalId,
      }).preconditionHash,
    ).not.toBe(preview.preconditionHash);
  });

  it("rejects direct cloud register repair projection while closeout review is open", async () => {
    const repository = createRepairProjectionRepository({
      registerSession: {
        _id: "register-1",
        status: "active",
        storeId,
        terminalId,
      },
      reviewRegisterSessionIds: new Set(["register-1"]),
      validCloudIds: new Set(["register-1"]),
    });

    await expect(
      canProjectRegisterOpenForTerminalCloudRepair(repository, {
        event: {
          localEventId: "event-1",
          localRegisterSessionId: "register-1",
          sequence: 2,
          eventType: "register_opened",
          occurredAt: 20,
          staffProfileId: "staff-1" as Id<"staffProfile">,
          staffProofToken: "proof-token-1",
          payload: {
            openingFloat: 100,
            registerNumber: "A1",
          },
        },
        now,
        storeId,
        terminalId,
      }),
    ).resolves.toBe(false);
  });

  it("allows terminal cloud repair to project a replacement open after closeout ownership", async () => {
    const repository = createRepairProjectionRepository({
      blockingRegisterSession: {
        _id: "register-closing",
        closeoutOwnedAt: 20,
        closeoutOwnershipSource: "closeout_submission",
        closeoutRecords: [],
        status: "closing",
        storeId,
        terminalId,
      },
    });

    await expect(
      canProjectRegisterOpenForTerminalCloudRepair(repository, {
        event: {
          localEventId: "event-replacement-open",
          localRegisterSessionId: "register-replacement",
          sequence: 2,
          eventType: "register_opened",
          occurredAt: 30,
          staffProfileId: "staff-1" as Id<"staffProfile">,
          staffProofToken: "proof-token-1",
          payload: {
            openingFloat: 100,
            registerNumber: "A1",
          },
        },
        now,
        storeId,
        terminalId,
      }),
    ).resolves.toBe(true);
  });

  it("rejects terminal cloud repair for stale replacement opens before closeout ownership", async () => {
    const repository = createRepairProjectionRepository({
      blockingRegisterSession: {
        _id: "register-closing",
        closeoutOwnedAt: 20,
        closeoutOwnershipSource: "closeout_submission",
        closeoutRecords: [],
        status: "closing",
        storeId,
        terminalId,
      },
    });

    await expect(
      canProjectRegisterOpenForTerminalCloudRepair(repository, {
        event: {
          localEventId: "event-stale-replacement-open",
          localRegisterSessionId: "register-stale-replacement",
          sequence: 2,
          eventType: "register_opened",
          occurredAt: 10,
          staffProfileId: "staff-1" as Id<"staffProfile">,
          staffProofToken: "proof-token-1",
          payload: {
            openingFloat: 100,
            registerNumber: "A1",
          },
        },
        now,
        storeId,
        terminalId,
      }),
    ).resolves.toBe(false);
  });
});

function createRepairProjectionRepository(overrides: {
  blockingRegisterSession?: {
    _id: string;
    closeoutOwnedAt?: number;
    closeoutOwnershipSource?: string;
    closeoutRecords?: unknown[];
    status: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  } | null;
  registerSession?: {
    _id: string;
    closeoutOwnedAt?: number;
    closeoutOwnershipSource?: string;
    closeoutRecords?: unknown[];
    status: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  } | null;
  reviewRegisterSessionIds?: Set<string>;
  validCloudIds?: Set<string>;
} = {}): TerminalCloudRepairProjectionEligibilityRepository {
  return {
    async findBlockingRegisterSession() {
      return overrides.blockingRegisterSession
        ? ({
            closeoutRecords: [],
            expectedCash: 100,
            registerNumber: "A1",
            ...overrides.blockingRegisterSession,
          } as never)
        : null;
    },
    async getRegisterSession(registerSessionId) {
      return overrides.registerSession &&
        overrides.registerSession._id === registerSessionId
        ? ({
            closeoutRecords: [],
            expectedCash: 100,
            registerNumber: "A1",
            ...overrides.registerSession,
          } as never)
        : null;
    },
    async getStaffProfile(staffProfileId) {
      return staffProfileId === "staff-1"
        ? ({
            _id: "staff-1",
            status: "active",
            storeId,
          } as never)
        : null;
    },
    async getTerminal(id) {
      return id === terminalId
        ? ({
            _id: terminalId,
            registerNumber: "A1",
            status: "active",
            storeId,
          } as never)
        : null;
    },
    async hasActivePosRole() {
      return true;
    },
    async listOpenRegisterReviewConflictFacts(args) {
      return overrides.reviewRegisterSessionIds?.has(args.registerSessionId) === true
        ? [
            {
              conflict: {
                _id: "conflict-1",
                conflictType: "permission",
                createdAt: now - 1_000,
                details: {
                  closeoutOccurredAt: now - 2_000,
                  countedCash: 100,
                  expectedCash: 90,
                  variance: 10,
                },
                localEventId: "event-closeout-1",
                localRegisterSessionId: args.registerSessionId,
                sequence: 1,
                status: "needs_review",
                storeId: args.storeId,
                summary:
                  "Register closeout variance requires manager review before synced closeout can be applied.",
                terminalId: args.terminalId,
              },
              directRegisterSession: {
                _id: args.registerSessionId,
                storeId: args.storeId,
                terminalId: args.terminalId,
              },
              registerSessionMapping: null,
            },
          ]
        : [];
    },
    normalizeCloudId(_tableName, value) {
      return overrides.validCloudIds?.has(value) ? (value as never) : null;
    },
  };
}

function buildConflict(
  overrides: Partial<Doc<"posLocalSyncConflict">> = {},
): Doc<"posLocalSyncConflict"> {
  return {
    _id: "conflict-1" as Id<"posLocalSyncConflict">,
    _creationTime: now - 20 * 60 * 1000,
    storeId,
    terminalId,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    sequence: 1,
    conflictType: "duplicate_local_id",
    status: "needs_review",
    summary: "Duplicate register-open attempt.",
    details: { reason: "duplicate_register_opened" },
    createdAt: now - 20 * 60 * 1000,
    ...overrides,
  } as Doc<"posLocalSyncConflict">;
}

function buildEvent(
  overrides: Partial<Doc<"posLocalSyncEvent">> = {},
): Doc<"posLocalSyncEvent"> {
  return {
    _id: "event-1-id" as Id<"posLocalSyncEvent">,
    _creationTime: now - 20 * 60 * 1000,
    storeId,
    terminalId,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    eventType: "register_opened",
    occurredAt: now - 20 * 60 * 1000,
    staffProfileId: "staff-1" as Id<"staffProfile">,
    payload: {
      openingFloat: 100,
      registerNumber: "A1",
    },
    status: "conflicted",
    submittedAt: now - 19 * 60 * 1000,
    ...overrides,
  } as Doc<"posLocalSyncEvent">;
}

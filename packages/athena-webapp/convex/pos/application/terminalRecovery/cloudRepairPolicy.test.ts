import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import {
  buildTerminalCloudRepairPreview,
  classifyTerminalCloudRepairConflict,
} from "./cloudRepairPolicy";

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
});

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

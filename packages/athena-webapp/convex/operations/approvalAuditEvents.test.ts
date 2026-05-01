import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  recordApprovalDecisionRecordedAuditEventWithCtx,
  recordApprovedCommandAppliedAuditEventWithCtx,
  recordApprovalRequiredAuditEventWithCtx,
  recordAsyncApprovalRequestCreatedAuditEventWithCtx,
} from "./approvalAuditEvents";

function createOperationalEventCtx(args?: { failInsert?: boolean }) {
  const operationalEvent = new Map<string, Record<string, unknown>>();

  const ctx = {
    db: {
      query(table: "operationalEvent") {
        if (table !== "operationalEvent") {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          withIndex(
            _index: string,
            applyIndex: (queryBuilder: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown
          ) {
            const filters: Array<[string, unknown]> = [];
            const queryBuilder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return queryBuilder;
              },
            };

            applyIndex(queryBuilder);

            return {
              collect: async () =>
                Array.from(operationalEvent.values()).filter((record) =>
                  filters.every(([field, value]) => record[field] === value)
                ),
            };
          },
        };
      },
      async insert(table: "operationalEvent", value: Record<string, unknown>) {
        if (args?.failInsert) {
          throw new Error("operational event rail unavailable");
        }

        const id = `event-${operationalEvent.size + 1}`;
        operationalEvent.set(id, { _id: id, ...value });
        return id;
      },
      async get(table: "operationalEvent", id: string) {
        return operationalEvent.get(id) ?? null;
      },
    },
  } as unknown as MutationCtx;

  return { ctx, operationalEvent };
}

describe("approval audit events", () => {
  it("records approval audit events through the operational event rail", async () => {
    const { ctx, operationalEvent } = createOperationalEventCtx();

    await recordApprovalRequiredAuditEventWithCtx(ctx, {
      actionKey: "cash.register.closeout.submit",
      reason: "Variance exceeded threshold.",
      requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      requiredRole: "manager",
      storeId: "store-1" as Id<"store">,
      subject: {
        type: "register_session",
        id: "register-session-1",
      },
    });
    await recordAsyncApprovalRequestCreatedAuditEventWithCtx(ctx, {
      actionKey: "cash.register.closeout.submit",
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      requiredRole: "manager",
      storeId: "store-1" as Id<"store">,
      subject: {
        type: "register_session",
        id: "register-session-1",
      },
    });
    await recordApprovalDecisionRecordedAuditEventWithCtx(ctx, {
      actionKey: "cash.register.closeout.review",
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      storeId: "store-1" as Id<"store">,
      subject: {
        type: "register_session",
        id: "register-session-1",
      },
    });
    await recordApprovedCommandAppliedAuditEventWithCtx(ctx, {
      actionKey: "cash.register.closeout.apply",
      approvalProofId: "proof-1",
      approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      storeId: "store-1" as Id<"store">,
      subject: {
        type: "register_session",
        id: "register-session-1",
      },
    });

    expect(Array.from(operationalEvent.values())).toEqual([
      expect.objectContaining({ eventType: "approval.required" }),
      expect.objectContaining({
        approvalRequestId: "approval-1",
        eventType: "approval.async_request_created",
      }),
      expect.objectContaining({ eventType: "approval.decision_recorded" }),
      expect.objectContaining({
        eventType: "approval.approved_command_applied",
        metadata: expect.objectContaining({
          actionKey: "cash.register.closeout.apply",
          approvalProofId: "proof-1",
        }),
      }),
    ]);
  });

  it("treats operational event failures as best-effort", async () => {
    const { ctx } = createOperationalEventCtx({ failInsert: true });

    await expect(
      recordApprovalRequiredAuditEventWithCtx(ctx, {
        actionKey: "cash.register.closeout.submit",
        storeId: "store-1" as Id<"store">,
        subject: {
          type: "register_session",
          id: "register-session-1",
        },
      })
    ).resolves.toBeNull();
  });
});

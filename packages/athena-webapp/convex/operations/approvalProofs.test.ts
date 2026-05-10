import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  consumeApprovalProofWithCtx,
  createApprovalProofWithCtx,
} from "./approvalProofs";

type ApprovalProofRow = Record<string, unknown> & { _id: string };

function createApprovalProofMutationCtx(seed?: { proofs?: ApprovalProofRow[] }) {
  const tables = {
    approvalProof: new Map<string, ApprovalProofRow>(
      (seed?.proofs ?? []).map((proof) => [proof._id, proof])
    ),
    operationalEvent: new Map<string, ApprovalProofRow>(),
  };
  const insertCounters: Record<keyof typeof tables, number> = {
    approvalProof: 0,
    operationalEvent: 0,
  };

  function query(table: keyof typeof tables) {
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
            Array.from(tables[table].values()).filter((record) =>
              filters.every(([field, value]) => record[field] === value)
            ),
          first: async () =>
            Array.from(tables[table].values()).find((record) =>
              filters.every(([field, value]) => record[field] === value)
            ) ?? null,
        };
      },
    };
  }

  const ctx = {
    db: {
      async get(table: keyof typeof tables, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(table: keyof typeof tables, value: Record<string, unknown>) {
        insertCounters[table] += 1;
        const id = `${table}-${insertCounters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(
        table: keyof typeof tables,
        id: string,
        value: Record<string, unknown>
      ) {
        const existing = tables[table].get(id);
        if (!existing) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existing, ...value });
      },
      query,
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("approval proofs", () => {
  it("creates a short-lived action-bound proof and records the grant event", async () => {
    const { ctx, tables } = createApprovalProofMutationCtx();
    const before = Date.now();

    const result = await createApprovalProofWithCtx(ctx, {
      actionKey: "pos.transaction.payment_method.correct",
      approvedByCredentialId: "credential-1" as Id<"staffCredential">,
      approvedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      organizationId: "org-1" as Id<"organization">,
      reason: "Completed transactions require manager approval.",
      requiredRole: "manager",
      requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      storeId: "store-1" as Id<"store">,
      subject: {
        type: "pos_transaction",
        id: "transaction-1",
        label: "Receipt 1001",
      },
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        approvalProofId: "approvalProof-1",
        expiresAt: expect.any(Number),
      }),
    });
    if (result.kind !== "ok") {
      throw new Error("Expected approval proof creation to succeed.");
    }
    expect(result.data.expiresAt).toBeGreaterThanOrEqual(before + 300_000);
    expect(result.data.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(tables.approvalProof.get("approvalProof-1")).toMatchObject({
      actionKey: "pos.transaction.payment_method.correct",
      approvedByStaffProfileId: "manager-1",
      requiredRole: "manager",
      requestedByStaffProfileId: "cashier-1",
      storeId: "store-1",
      subjectId: "transaction-1",
      subjectType: "pos_transaction",
    });
    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        eventType: "approval.manager_granted",
        actorStaffProfileId: "manager-1",
        subjectId: "transaction-1",
      }),
    ]);
  });

  it("validates and consumes one matching proof", async () => {
    const now = Date.now();
    const { ctx, tables } = createApprovalProofMutationCtx({
      proofs: [
        {
          _id: "proof-1",
          actionKey: "pos.transaction.payment_method.correct",
          approvedByCredentialId: "credential-1",
          approvedByStaffProfileId: "manager-1",
          createdAt: now - 1_000,
          expiresAt: now + 60_000,
          requiredRole: "manager",
          storeId: "store-1",
          subjectId: "transaction-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    const result = await consumeApprovalProofWithCtx(ctx, {
      actionKey: "pos.transaction.payment_method.correct",
      approvalProofId: "proof-1" as Id<"approvalProof">,
      requiredRole: "manager",
      storeId: "store-1" as Id<"store">,
      subject: {
        type: "pos_transaction",
        id: "transaction-1",
      },
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        approvalProofId: "proof-1",
        approvedByStaffProfileId: "manager-1",
      }),
    });
    expect(tables.approvalProof.get("proof-1")?.consumedAt).toEqual(
      expect.any(Number)
    );
    expect(Array.from(tables.operationalEvent.values())).toEqual([
      expect.objectContaining({
        eventType: "approval.proof_consumed",
        actorStaffProfileId: "manager-1",
        subjectId: "transaction-1",
      }),
    ]);
  });

  it("rejects subject mismatches without consuming the proof", async () => {
    const now = Date.now();
    const { ctx, tables } = createApprovalProofMutationCtx({
      proofs: [
        {
          _id: "proof-1",
          actionKey: "pos.transaction.payment_method.correct",
          approvedByCredentialId: "credential-1",
          approvedByStaffProfileId: "manager-1",
          createdAt: now - 1_000,
          expiresAt: now + 60_000,
          requiredRole: "manager",
          storeId: "store-1",
          subjectId: "transaction-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      consumeApprovalProofWithCtx(ctx, {
        actionKey: "pos.transaction.payment_method.correct",
        approvalProofId: "proof-1" as Id<"approvalProof">,
        requiredRole: "manager",
        storeId: "store-1" as Id<"store">,
        subject: {
          type: "pos_transaction",
          id: "transaction-2",
        },
      })
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
      },
    });
    expect(tables.approvalProof.get("proof-1")?.consumedAt).toBeUndefined();
  });

  it("rejects requester mismatches without consuming the proof", async () => {
    const now = Date.now();
    const { ctx, tables } = createApprovalProofMutationCtx({
      proofs: [
        {
          _id: "proof-1",
          actionKey: "pos.transaction.payment_method.correct",
          approvedByCredentialId: "credential-1",
          approvedByStaffProfileId: "manager-1",
          createdAt: now - 1_000,
          expiresAt: now + 60_000,
          requestedByStaffProfileId: "cashier-1",
          requiredRole: "manager",
          storeId: "store-1",
          subjectId: "transaction-1",
          subjectType: "pos_transaction",
        },
      ],
    });

    await expect(
      consumeApprovalProofWithCtx(ctx, {
        actionKey: "pos.transaction.payment_method.correct",
        approvalProofId: "proof-1" as Id<"approvalProof">,
        requestedByStaffProfileId: "cashier-2" as Id<"staffProfile">,
        requiredRole: "manager",
        storeId: "store-1" as Id<"store">,
        subject: {
          type: "pos_transaction",
          id: "transaction-1",
        },
      })
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Approval proof requester does not match this command.",
      },
    });
    expect(tables.approvalProof.get("proof-1")?.consumedAt).toBeUndefined();
  });

  it("rejects consumed, expired, cross-store, and wrong-role proofs", async () => {
    const now = Date.now();
    const cases = [
      { _id: "consumed", consumedAt: now - 500, expiresAt: now + 60_000 },
      { _id: "expired", expiresAt: now - 1 },
      { _id: "cross-store", expiresAt: now + 60_000, storeId: "store-2" },
      { _id: "wrong-role", expiresAt: now + 60_000, requiredRole: "cashier" },
    ];

    for (const proofCase of cases) {
      const { ctx } = createApprovalProofMutationCtx({
        proofs: [
          {
            _id: proofCase._id,
            actionKey: "pos.transaction.payment_method.correct",
            approvedByCredentialId: "credential-1",
            approvedByStaffProfileId: "manager-1",
            createdAt: now - 1_000,
            expiresAt: proofCase.expiresAt,
            requiredRole: proofCase.requiredRole ?? "manager",
            storeId: proofCase.storeId ?? "store-1",
            subjectId: "transaction-1",
            subjectType: "pos_transaction",
            ...(proofCase.consumedAt
              ? { consumedAt: proofCase.consumedAt }
              : {}),
          },
        ],
      });

      await expect(
        consumeApprovalProofWithCtx(ctx, {
          actionKey: "pos.transaction.payment_method.correct",
          approvalProofId: proofCase._id as Id<"approvalProof">,
          requiredRole: "manager",
          storeId: "store-1" as Id<"store">,
          subject: {
            type: "pos_transaction",
            id: "transaction-1",
          },
        })
      ).resolves.toMatchObject({
        kind: "user_error",
        error: {
          code: "precondition_failed",
        },
      });
    }
  });

  it("does not treat manager elevation state as an action-bound approval proof", async () => {
    const { ctx } = createApprovalProofMutationCtx();

    await expect(
      consumeApprovalProofWithCtx(ctx, {
        actionKey: "cash_controls.closeout.complete",
        approvalProofId: "managerElevation-1" as Id<"approvalProof">,
        requiredRole: "manager",
        storeId: "store-1" as Id<"store">,
        subject: {
          type: "register_session",
          id: "register-session-1",
        },
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
      },
    });
  });

  it("keeps approval proofs bound to the command action even when a manager is present", async () => {
    const now = Date.now();
    const { ctx, tables } = createApprovalProofMutationCtx({
      proofs: [
        {
          _id: "proof-1",
          actionKey: "pos.transaction.payment_method.correct",
          approvedByCredentialId: "credential-1",
          approvedByStaffProfileId: "manager-1",
          createdAt: now - 1_000,
          expiresAt: now + 60_000,
          requiredRole: "manager",
          storeId: "store-1",
          subjectId: "register-session-1",
          subjectType: "register_session",
        },
      ],
    });

    await expect(
      consumeApprovalProofWithCtx(ctx, {
        actionKey: "cash_controls.closeout.complete",
        approvalProofId: "proof-1" as Id<"approvalProof">,
        requiredRole: "manager",
        storeId: "store-1" as Id<"store">,
        subject: {
          type: "register_session",
          id: "register-session-1",
        },
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
      },
    });
    expect(tables.approvalProof.get("proof-1")?.consumedAt).toBeUndefined();
  });
});

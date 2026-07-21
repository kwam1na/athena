import { describe, expect, it, vi } from "vitest";

import { defineOperation } from "./definitions";
import { resolveOperationAdmission } from "./adapters";
import type { OperationAdapter } from "./types";

const definition = defineOperation({
  operationId: "test.operation",
  capability: "daily_operations.write",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "deny" },
});

describe("operation admission adapters", () => {
  it("uses a recognized demo principal decision without falling back to normal auth", async () => {
    const normalAdapter: OperationAdapter = {
      kind: "normal_user" as const,
      resolve: vi.fn(),
    };
    const sharedDemoAdapter: OperationAdapter = {
      kind: "shared_demo" as const,
      resolve: vi.fn(async () => ({
        error: new Error("This action isn't allowed in the demo."),
        kind: "denied" as const,
        reason: "capability_denied" as const,
        recognized: true,
      })),
    };

    await expect(
      resolveOperationAdmission(
        { db: {} } as never,
        { storeId: "store-1" },
        definition,
        { normalAdapter, sharedDemoAdapter },
      ),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(normalAdapter.resolve).not.toHaveBeenCalled();
  });

  it("falls through to normal auth only when demo is not applicable", async () => {
    const normalAdapter: OperationAdapter = {
      kind: "normal_user" as const,
      resolve: vi.fn(async () => ({
        actor: { kind: "normal_user" as const, athenaUserId: "user-1" as never },
        constraints: {
          organizationId: "org-1" as never,
          storeId: "store-1" as never,
        },
        decision: { adapter: "normal_user" as const, outcome: "admitted" as const },
        provenance: { kind: "normal_user" as const },
      })),
    };
    const sharedDemoAdapter: OperationAdapter = {
      kind: "shared_demo" as const,
      resolve: vi.fn(async () => ({ kind: "not_applicable" as const })),
    };

    await expect(
      resolveOperationAdmission(
        { db: {} } as never,
        { storeId: "store-1" },
        definition,
        { normalAdapter, sharedDemoAdapter },
      ),
    ).resolves.toMatchObject({
      actor: { kind: "normal_user", athenaUserId: "user-1" },
    });
  });
});

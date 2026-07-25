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

  it("admits an anonymous caller for a public-opted-in mutation", async () => {
    const anonymousNormalAdapter: OperationAdapter = {
      kind: "normal_user" as const,
      resolve: vi.fn(async () => ({ kind: "not_applicable" as const })),
    };

    const publicDefinition = defineOperation({
      operationId: "test.public.operation",
      capability: "daily_operations.write",
      scope: { kind: "store", storeIdArg: "storeId" },
      readiness: { kind: "store_write" },
      effects: { mode: "none" },
      actors: { normalUser: "admit", sharedDemo: "deny", public: "admit" },
    });

    await expect(
      resolveOperationAdmission(
        { db: {} } as never,
        { storeId: "store-1" },
        publicDefinition,
        { normalAdapter: anonymousNormalAdapter },
      ),
    ).resolves.toMatchObject({
      actor: { kind: "public" },
      constraints: { storeId: "store-1" },
    });
  });

  it("rejects an anonymous caller when the mutation does not opt public in", async () => {
    const anonymousNormalAdapter: OperationAdapter = {
      kind: "normal_user" as const,
      resolve: vi.fn(async () => ({ kind: "not_applicable" as const })),
    };

    await expect(
      resolveOperationAdmission(
        { db: {} } as never,
        { storeId: "store-1" },
        definition,
        { normalAdapter: anonymousNormalAdapter },
      ),
    ).rejects.toThrow("Sign in again to continue.");
  });
});

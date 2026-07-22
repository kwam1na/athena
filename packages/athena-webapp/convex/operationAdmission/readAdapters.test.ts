import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineReadOperation } from "./readDefinitions";
import {
  createSharedDemoReadOperationAdapter,
  resolveReadOperationAdmission,
} from "./readAdapters";
import type { OperationReadAdapter } from "./types";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

import { getAuthUserId } from "@convex-dev/auth/server";

const definition = defineReadOperation({
  operationId: "demo.read",
  access: { kind: "read", intent: "demo.view" },
  scope: { kind: "store", storeIdArg: "storeId" },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

describe("operation read admission adapters", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
  });

  it("does not fall back to normal auth for expired recognized demo principals", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const normalAdapter: OperationReadAdapter = {
      kind: "normal_user",
      resolve: vi.fn(),
    };

    await expect(
      resolveReadOperationAdmission(
        demoCtx({
          principal: {
            admissionExpiresAt: Date.now() - 1,
            athenaUserId: "athena-user",
            authUserId: "auth-user",
            organizationId: "org-1",
            storeId: "store-1",
          },
        }) as never,
        { storeId: "store-1" },
        definition,
        {
          normalAdapter,
          sharedDemoAdapter: createSharedDemoReadOperationAdapter(),
        },
      ),
    ).rejects.toThrow("demo session has expired");
    expect(normalAdapter.resolve).not.toHaveBeenCalled();
  });

  it("does not fall back to normal auth for disabled recognized demo principals", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "");
    const normalAdapter: OperationReadAdapter = {
      kind: "normal_user",
      resolve: vi.fn(),
    };

    await expect(
      resolveReadOperationAdmission(
        demoCtx({
          principal: {
            admissionExpiresAt: Date.now() + 60_000,
            athenaUserId: "athena-user",
            authUserId: "auth-user",
            organizationId: "org-1",
            storeId: "store-1",
          },
        }) as never,
        { storeId: "store-1" },
        definition,
        {
          normalAdapter,
          sharedDemoAdapter: createSharedDemoReadOperationAdapter(),
        },
      ),
    ).rejects.toThrow("demo is unavailable in this environment");
    expect(normalAdapter.resolve).not.toHaveBeenCalled();
  });
});

function demoCtx(args: { principal: Record<string, unknown> | null }) {
  return {
    auth: { getUserIdentity: vi.fn() },
    db: {
      query: vi.fn(() => ({
        withIndex: vi.fn((_name, apply) => {
          apply({ eq: vi.fn().mockReturnThis() });
          return { unique: vi.fn().mockResolvedValue(args.principal) };
        }),
      })),
    },
  };
}

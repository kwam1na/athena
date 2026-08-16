import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineReadOperation } from "./readDefinitions";
import { resolveAdmissionChain } from "./adapters";
import { createPublicReadOperationAdapter } from "./readAdapters";
import { createSharedDemoReadOperationAdapter } from "../sharedDemo/readOperationAdapter";
import type { OperationReadAdapter } from "./types";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

import { getAuthUserId } from "@convex-dev/auth/server";

const definition = defineReadOperation({
  kind: "query" as const,
  operationId: "demo.read",
  access: { kind: "read", intent: "pos.view" as const },
  scope: { kind: "store", storeIdArg: "storeId" },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
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
      resolveAdmissionChain(
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
        [createSharedDemoReadOperationAdapter(), normalAdapter],
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
      resolveAdmissionChain(
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
        [createSharedDemoReadOperationAdapter(), normalAdapter],
      ),
    ).rejects.toThrow("demo is unavailable in this environment");
    expect(normalAdapter.resolve).not.toHaveBeenCalled();
  });

  it("admits an anonymous caller for a public-opted-in read", async () => {
    const anonymousNormalAdapter: OperationReadAdapter = {
      kind: "normal_user",
      resolve: vi.fn(async () => ({ kind: "unauthenticated" as const })),
    };

    const publicDefinition = defineReadOperation({
      operationId: "storefront.read",
      access: { kind: "read", intent: "inventory.catalog.view" as const },
      scope: { kind: "store", storeIdArg: "storeId" },
      kind: "query" as const,
      actors: { normalUser: "admit", sharedDemo: "admit", public: "admit" },
    });

    await expect(
      resolveAdmissionChain(
        demoCtx({ principal: null }) as never,
        { storeId: "store-1" },
        publicDefinition,
        [
          createSharedDemoReadOperationAdapter(),
          anonymousNormalAdapter,
          createPublicReadOperationAdapter(),
        ],
      ),
    ).resolves.toMatchObject({
      actor: { kind: "public" },
      constraints: { storeId: "store-1" },
    });
  });

  it("rejects an anonymous caller when the read does not opt public in", async () => {
    const anonymousNormalAdapter: OperationReadAdapter = {
      kind: "normal_user",
      resolve: vi.fn(async () => ({ kind: "unauthenticated" as const })),
    };

    await expect(
      resolveAdmissionChain(
        demoCtx({ principal: null }) as never,
        { storeId: "store-1" },
        definition,
        [
          createSharedDemoReadOperationAdapter(),
          anonymousNormalAdapter,
          createPublicReadOperationAdapter(),
        ],
      ),
    ).rejects.toThrow("Sign in again to continue.");
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

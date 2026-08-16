import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));

import { getAuthUserId } from "@convex-dev/auth/server";

import { defineReadOperation } from "../operationAdmission/domains/_shapes";
import { createSharedDemoReadOperationAdapter } from "./readOperationAdapter";

const grantedRead = defineReadOperation({
  kind: "query" as const,
  operationId: "demo.grantedRead",
  access: { kind: "read" as const, intent: "pos.view" as const },
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "admit" as const,
    public: "deny" as const,
  },
});

// Declaring `sharedDemo: "admit"` is not enough: read reach is decided by the
// shared-demo grant set, which does not include cost-overlay evidence.
const ungrantedIntentRead = defineReadOperation({
  ...grantedRead,
  operationId: "demo.ungrantedIntentRead",
  access: {
    kind: "read" as const,
    intent: "inventory.cost_overlay.view" as const,
  },
});

describe("shared demo read operation adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
  });

  it("admits a granted read intent inside the demo store", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);

    await expect(
      createSharedDemoReadOperationAdapter().resolve(
        demoCtx() as never,
        { storeId: "store-1" },
        grantedRead,
      ),
    ).resolves.toMatchObject({
      actor: { kind: "shared_demo", storeId: "store-1" },
      constraints: { organizationId: "org-1", storeId: "store-1" },
      provenance: { readIntent: "pos.view" },
    });
  });

  it("denies a read intent outside the shared-demo grant set", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);

    await expect(
      createSharedDemoReadOperationAdapter().resolve(
        demoCtx() as never,
        { storeId: "store-1" },
        ungrantedIntentRead,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "capability_denied",
    });
  });

  it("denies a read scoped to another store", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);

    await expect(
      createSharedDemoReadOperationAdapter().resolve(
        demoCtx() as never,
        { storeId: "store-2" },
        grantedRead,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "scope_denied",
    });
  });

  it("reports an expired session as its own typed denial", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);

    await expect(
      createSharedDemoReadOperationAdapter().resolve(
        demoCtx({ admissionExpiresAt: Date.now() - 1 }) as never,
        { storeId: "store-1" },
        grantedRead,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "session_expired",
    });
  });

  it("is not applicable when no demo principal is present", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);

    await expect(
      createSharedDemoReadOperationAdapter().resolve(
        demoCtx(null) as never,
        { storeId: "store-1" },
        grantedRead,
      ),
    ).resolves.toEqual({ kind: "not_applicable" });
  });
});

function demoCtx(
  overrides: Record<string, unknown> | null = {},
): Record<string, unknown> {
  const principal =
    overrides === null
      ? null
      : {
          admissionExpiresAt: Date.now() + 60_000,
          athenaUserId: "athena-user",
          authUserId: "auth-user",
          organizationId: "org-1",
          storeId: "store-1",
          ...overrides,
        };
  return {
    auth: { getUserIdentity: vi.fn() },
    db: {
      query: vi.fn(() => ({
        withIndex: vi.fn((_name: string, apply: Function) => {
          apply({ eq: vi.fn().mockReturnThis() });
          return { unique: vi.fn().mockResolvedValue(principal) };
        }),
      })),
    },
  };
}

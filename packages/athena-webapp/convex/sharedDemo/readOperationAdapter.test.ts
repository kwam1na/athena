import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));

import { getAuthUserId } from "@convex-dev/auth/server";

import { defineReadOperation } from "../operationAdmission/domains/_shapes";
import { SHARED_DEMO_SESSION_EXPIRED_CODE } from "../../shared/sharedDemoActionError";
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

// `app:getCurrentUser` is shaped like this: a read the demo is granted AND the
// public may make. It is the reason the expiry exception is write-only.
const publicAdmittedRead = defineReadOperation({
  ...grantedRead,
  operationId: "demo.publicAdmittedRead",
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "admit" as const,
    public: "admit" as const,
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

  it("carries the expiry as client-readable data, not as a message", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);

    const outcome = (await createSharedDemoReadOperationAdapter().resolve(
      demoCtx({ admissionExpiresAt: Date.now() - 1 }) as never,
      { storeId: "store-1" },
      grantedRead,
    )) as { error?: { data?: unknown } };

    // Convex scrubs the message of a plain Error outside dev, so a client that
    // matched on message text would recognize expiry only on a developer's
    // machine. The code has to travel as ConvexError data.
    expect((outcome.error as { data?: { code?: string } })?.data?.code).toBe(
      SHARED_DEMO_SESSION_EXPIRED_CODE,
    );
  });

  it("still denies an expired session on a read the public may also make", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);

    // Falling through to `public` here would answer the identity probe
    // successfully. The app would then see a half-identified visitor instead
    // of an expired demo, redirect to a sign-in form they have no credentials
    // for, and never renew. The denial is the signal the client renews on.
    await expect(
      createSharedDemoReadOperationAdapter().resolve(
        demoCtx({ admissionExpiresAt: Date.now() - 1 }) as never,
        { storeId: "store-1" },
        publicAdmittedRead,
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

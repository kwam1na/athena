import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineOperation } from "../operationAdmission/definitions";
import { createSharedDemoOperationAdapter } from "./operationAdapter";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

import { getAuthUserId } from "@convex-dev/auth/server";

const admittedDefinition = defineOperation({
  operationId: "demo.allowed",
  capability: "daily_operations.write",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

const organizationScopedDefinition = defineOperation({
  operationId: "demo.organization",
  capability: "daily_operations.write",
  scope: {
    kind: "organization",
    organizationIdArg: "organizationId",
  },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

const deniedDefinition = defineOperation({
  operationId: "demo.denied",
  capability: "exports.generate",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "protected", gateways: ["export.deliver"] },
  actors: { normalUser: "admit", sharedDemo: "deny" },
});

const deniedEffectDefinition = defineOperation({
  operationId: "demo.deniedEffect",
  capability: "orders.fulfill",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "protected", gateways: ["payment.refund"] },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

const simulatedEffectDefinition = defineOperation({
  operationId: "demo.simulatedEffect",
  capability: "orders.fulfill",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "protected", gateways: ["order_notification.send"] },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

describe("shared demo operation adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
  });

  it("admits an allowed demo write through the server-owned store and restore fence", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ready = vi.fn();
    const ctx = demoCtx({
      principal: {
        admissionExpiresAt: Date.now() + 60_000,
        athenaUserId: "athena-user",
        authUserId: "auth-user",
        organizationId: "org-1",
        storeId: "store-1",
      },
    });

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite: ready }).resolve(
        ctx as never,
        { storeId: "store-1" },
        admittedDefinition,
      ),
    ).resolves.toMatchObject({
      actor: { kind: "shared_demo", storeId: "store-1" },
      constraints: { organizationId: "org-1", storeId: "store-1" },
      decision: { adapter: "shared_demo", outcome: "admitted" },
    });
    expect(ready).toHaveBeenCalledWith(ctx, { storeId: "store-1" });
  });

  it("denies recognized demo principals through demo policy", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ctx = demoCtx({
      principal: {
        admissionExpiresAt: Date.now() + 60_000,
        athenaUserId: "athena-user",
        authUserId: "auth-user",
        organizationId: "org-1",
        storeId: "store-1",
      },
    });

    await expect(
      createSharedDemoOperationAdapter().resolve(
        ctx as never,
        { storeId: "store-1" },
        deniedDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "capability_denied",
    });
  });

  it("denies protected effects that shared demo policy does not simulate", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ready = vi.fn();
    const ctx = demoCtx({
      principal: {
        admissionExpiresAt: Date.now() + 60_000,
        athenaUserId: "athena-user",
        authUserId: "auth-user",
        organizationId: "org-1",
        storeId: "store-1",
      },
    });

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite: ready }).resolve(
        ctx as never,
        { storeId: "store-1" },
        deniedEffectDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "effect_denied",
    });
    expect(ready).not.toHaveBeenCalled();
  });

  it("admits protected effects that shared demo policy simulates", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ready = vi.fn();
    const ctx = demoCtx({
      principal: {
        admissionExpiresAt: Date.now() + 60_000,
        athenaUserId: "athena-user",
        authUserId: "auth-user",
        organizationId: "org-1",
        storeId: "store-1",
      },
    });

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite: ready }).resolve(
        ctx as never,
        { storeId: "store-1" },
        simulatedEffectDefinition,
      ),
    ).resolves.toMatchObject({
      actor: { kind: "shared_demo", storeId: "store-1" },
      decision: { adapter: "shared_demo", outcome: "admitted" },
    });
    expect(ready).toHaveBeenCalledWith(ctx, { storeId: "store-1" });
  });

  it("denies writes outside the server-owned demo store", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ready = vi.fn();
    const ctx = demoCtx({
      principal: {
        admissionExpiresAt: Date.now() + 60_000,
        athenaUserId: "athena-user",
        authUserId: "auth-user",
        organizationId: "org-1",
        storeId: "store-1",
      },
    });

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite: ready }).resolve(
        ctx as never,
        { storeId: "store-2" },
        admittedDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "scope_denied",
    });
    expect(ready).not.toHaveBeenCalled();
  });

  it("denies organization-scoped writes outside the demo organization", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ctx = demoCtx({
      principal: {
        admissionExpiresAt: Date.now() + 60_000,
        athenaUserId: "athena-user",
        authUserId: "auth-user",
        organizationId: "org-1",
        storeId: "store-1",
      },
    });

    await expect(
      createSharedDemoOperationAdapter().resolve(
        ctx as never,
        { organizationId: "org-2" },
        organizationScopedDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "scope_denied",
    });
  });

  it("denies expired recognized demo principals instead of falling through", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ctx = demoCtx({
      principal: {
        admissionExpiresAt: Date.now() - 1,
        athenaUserId: "athena-user",
        authUserId: "auth-user",
        organizationId: "org-1",
        storeId: "store-1",
      },
    });

    await expect(
      createSharedDemoOperationAdapter().resolve(
        ctx as never,
        { storeId: "store-1" },
        admittedDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "actor_denied",
    });
  });

  it("denies stale restore epochs before invoking the domain handler", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ready = vi.fn(async () => {
      throw new Error("The demo is being restored. Try again shortly.");
    });
    const ctx = demoCtx({
      principal: {
        admissionExpiresAt: Date.now() + 60_000,
        athenaUserId: "athena-user",
        authUserId: "auth-user",
        organizationId: "org-1",
        storeId: "store-1",
      },
    });

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite: ready }).resolve(
        ctx as never,
        { expectedDemoRestoreEpoch: 41, storeId: "store-1" },
        defineOperation({
          ...admittedDefinition,
          readiness: {
            kind: "store_write",
            expectedEpochArg: "expectedDemoRestoreEpoch",
          },
        }),
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "readiness_denied",
    });
    expect(ready).toHaveBeenCalledWith(ctx, {
      expectedEpoch: 41,
      storeId: "store-1",
    });
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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineOperation } from "../operationAdmission/definitions";
import { issueSharedDemoTicketOperationDefinition } from "../operationAdmission/domains/platform_definitions";
import { createSharedDemoOperationAdapter } from "./operationAdapter";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

import { getAuthUserId } from "@convex-dev/auth/server";

const admittedDefinition = defineOperation({
  kind: "mutation" as const,
  operationId: "demo.allowed",
  capability: "daily_operations.write",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
});

// Public-admitted, but NOT the demo's lifecycle: a store-scoped POS write the
// demo already holds. The expiry exception must not reach it — the public
// adapter applies neither the demo store clamp nor the restore fence.
const publicAdmittedStoreWriteDefinition = defineOperation({
  kind: "mutation" as const,
  operationId: "demo.pos.terminalProof",
  capability: "pos.terminal.manage",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "admit" },
});

// Shaped like `sharedDemo/admission:issueSharedDemoTicket`: the demo's own
// lifecycle write, which an anonymous visitor may also perform.
const publicAdmittedDefinition = defineOperation({
  kind: "action" as const,
  operationId: "demo.lifecycle.ticket",
  capability: "demo.lifecycle",
  scope: { kind: "none" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "admit" },
});

const organizationScopedDefinition = defineOperation({
  kind: "mutation" as const,
  operationId: "demo.organization",
  capability: "daily_operations.write",
  scope: {
    kind: "organization",
    organizationIdArg: "organizationId",
  },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
});

const deniedDefinition = defineOperation({
  kind: "mutation" as const,
  operationId: "demo.denied",
  capability: "exports.generate",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "protected", gateways: ["export.deliver"] },
  actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
});

const deniedEffectDefinition = defineOperation({
  kind: "mutation" as const,
  operationId: "demo.deniedEffect",
  capability: "orders.fulfill",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "protected", gateways: ["unknown.gateway"] },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
});

const simulatedEffectDefinition = defineOperation({
  kind: "mutation" as const,
  operationId: "demo.simulatedEffect",
  capability: "orders.fulfill",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "protected", gateways: ["order_notification.send"] },
  actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
});

const dynamicBatchDefinition = defineOperation({
  kind: "mutation" as const,
  operationId: "demo.dynamicBatch",
  capability: {
    kind: "dynamic" as const,
    candidates: ["pos.sync.write", "cash.control.write", "exports.generate"],
    resolve: (args: Record<string, unknown>) =>
      (args.kinds as string[]) as never,
  },
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "store_write" as const },
  effects: { mode: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "admit" as const,
    public: "deny" as const,
  },
});

const storeReadyActionDefinition = defineOperation({
  kind: "action" as const,
  operationId: "demo.storeReadyAction",
  capability: "customer.messaging.send",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "store_ready" as const },
  effects: {
    mode: "protected" as const,
    gateways: ["order_notification.send"],
  },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "admit" as const,
    public: "deny" as const,
  },
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
      reason: "actor_denied",
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
      // Typed reason, not message text: an expired session is its own denial.
      reason: "session_expired",
    });
  });

  it("lets an expired session reach a write the public may also make", async () => {
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

    // This is the ticket mint that STARTS a demo session. Denying it to an
    // expired principal is a deadlock — taking a fresh admission would require
    // already holding a live one — and it is what leaves a visitor whose demo
    // expired unable to get back in, by any route including the manual one.
    //
    // Falling through cannot re-admit them as a normal user: a demo auth
    // identity is stored with a name and no email, and the normal-user adapter
    // resolves its Athena user by email. Only `public` can pick this up, which
    // grants strictly less than the demo already did.
    await expect(
      createSharedDemoOperationAdapter().resolve(
        ctx as never,
        {},
        publicAdmittedDefinition,
      ),
    ).resolves.toEqual({ kind: "not_applicable" });
  });

  it("keeps an expired session out of public writes that are not demo lifecycle", async () => {
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

    // Keying the exception on `public: "admit"` alone would release these:
    // a stale demo POS tab would keep writing terminal status into the demo
    // store as an anonymous caller, with the store clamp and the restore
    // fence both skipped — neither of which the public adapter applies.
    await expect(
      createSharedDemoOperationAdapter().resolve(
        ctx as never,
        { storeId: "store-1" },
        publicAdmittedStoreWriteDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "session_expired",
    });
  });

  it("pins the real ticket mint as the operation the exception depends on", () => {
    // The renewal path is only reachable because the REAL definition admits
    // the public actor and carries the demo lifecycle capability. The test
    // above uses a lookalike, so without this the whole recovery could be
    // switched off by an actor-policy edit with every unit test still green.
    expect(issueSharedDemoTicketOperationDefinition.actors.public).toBe(
      "admit",
    );
    expect(issueSharedDemoTicketOperationDefinition.capability).toBe(
      "demo.lifecycle",
    );
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

  it("denies a mixed dynamic capability batch before the handler runs", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ctx = demoCtx({ principal: activePrincipal() });

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite: vi.fn() }).resolve(
        ctx as never,
        { storeId: "store-1", kinds: ["pos.sync.write", "exports.generate"] },
        dynamicBatchDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "capability_denied",
    });
  });

  it("admits a dynamic batch when every resolved capability is granted", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ctx = demoCtx({ principal: activePrincipal() });

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite: vi.fn() }).resolve(
        ctx as never,
        { storeId: "store-1", kinds: ["pos.sync.write", "cash.control.write"] },
        dynamicBatchDefinition,
      ),
    ).resolves.toMatchObject({
      actor: { kind: "shared_demo", storeId: "store-1" },
    });
  });

  it("denies a dynamic resolver that returns a capability outside its candidates", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ctx = demoCtx({ principal: activePrincipal() });

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite: vi.fn() }).resolve(
        ctx as never,
        { storeId: "store-1", kinds: ["administration.destructive"] },
        dynamicBatchDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "capability_denied",
    });
  });

  it("applies the store_ready fence to an action while the store is restoring", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ready = vi.fn(async () => {
      throw new Error("The demo is being restored. Try again shortly.");
    });
    const ctx = demoCtx({ principal: activePrincipal() });

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite: ready }).resolve(
        ctx as never,
        { storeId: "store-1" },
        storeReadyActionDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "readiness_denied",
    });
    // store_ready never asserts an epoch: it is the fence, not a write.
    expect(ready).toHaveBeenCalledWith(ctx, {
      expectedEpoch: undefined,
      storeId: "store-1",
    });
  });
});

function activePrincipal() {
  return {
    admissionExpiresAt: Date.now() + 60_000,
    athenaUserId: "athena-user",
    authUserId: "auth-user",
    organizationId: "org-1",
    storeId: "store-1",
  };
}


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
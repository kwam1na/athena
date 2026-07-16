import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthSessionId: vi.fn(),
  getAuthUserId: vi.fn(),
  resolveServicePrincipalAuthBinding: vi.fn(),
  resolveServicePrincipalSession: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthSessionId: mocks.getAuthSessionId,
  getAuthUserId: mocks.getAuthUserId,
}));
vi.mock("./lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lifecycle")>()),
  resolveServicePrincipalAuthBinding:
    mocks.resolveServicePrincipalAuthBinding,
  resolveServicePrincipalSession: mocks.resolveServicePrincipalSession,
}));

import {
  getServicePrincipalActorWithCtx,
  requireServicePrincipalActorWithCtx,
} from "./actor";
import { ServicePrincipalFoundationError } from "./lifecycle";

const binding = {
  authUserId: "auth-user",
  organizationId: "organization",
  revision: 1,
  servicePrincipalAuthBindingId: "binding",
  servicePrincipalId: "principal",
  storeId: "store",
};

const session = {
  absoluteExpiresAt: 10_000,
  authSessionId: "auth-session",
  authUserId: "auth-user",
  capabilityRevision: 2,
  consumerId: "fixture",
  idleExpiresAt: 5_000,
  organizationId: "organization",
  principalLifecycleRevision: 1,
  requiredCapabilityId: "fixture.application",
  servicePrincipalAuthBindingId: "binding",
  servicePrincipalId: "principal",
  servicePrincipalSessionId: "service-session",
  sessionRevision: 1,
  storeId: "store",
};

function contextForBackingSession(
  backingSession: { expirationTime: number; userId: string } | null,
) {
  return {
    auth: { getUserIdentity: vi.fn() },
    db: {
      get: vi.fn().mockResolvedValue(backingSession),
    },
  };
}

describe("service-principal actor resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("auth-user");
    mocks.getAuthSessionId.mockResolvedValue("auth-session");
    mocks.resolveServicePrincipalAuthBinding.mockResolvedValue(binding);
    mocks.resolveServicePrincipalSession.mockResolvedValue(session);
  });

  it("returns null only when the Auth user has no service binding", async () => {
    mocks.resolveServicePrincipalAuthBinding.mockRejectedValue(
      new ServicePrincipalFoundationError("auth_binding_missing"),
    );

    await expect(
      getServicePrincipalActorWithCtx(
        contextForBackingSession(null) as never,
      ),
    ).resolves.toBeNull();
    expect(mocks.getAuthSessionId).not.toHaveBeenCalled();
  });

  it("resolves the exact current Auth session for a bound service user", async () => {
    const ctx = contextForBackingSession({
      expirationTime: 10_000,
      userId: "auth-user",
    });

    await expect(
      getServicePrincipalActorWithCtx(ctx as never, { now: 1_000 }),
    ).resolves.toEqual({ kind: "service_principal", ...session });
    expect(ctx.db.get).toHaveBeenCalledWith("authSessions", "auth-session");
    expect(mocks.resolveServicePrincipalSession).toHaveBeenCalledWith(
      expect.anything(),
      {
        authSessionId: "auth-session",
        authUserId: "auth-user",
        now: 1_000,
      },
    );
  });

  it.each([
    ["missing", null],
    ["wrong-user", { expirationTime: 10_000, userId: "other-user" }],
    ["expired", { expirationTime: 1_000, userId: "auth-user" }],
  ])("fails closed for a %s backing Auth session", async (_name, backing) => {
    await expect(
      getServicePrincipalActorWithCtx(
        contextForBackingSession(backing) as never,
        { now: 1_000 },
      ),
    ).rejects.toThrow("service session is no longer valid");
    expect(mocks.resolveServicePrincipalSession).not.toHaveBeenCalled();
  });

  it("does not treat a bound user with another exact session as unbound", async () => {
    mocks.resolveServicePrincipalSession.mockRejectedValue(
      new ServicePrincipalFoundationError("session_missing"),
    );

    await expect(
      getServicePrincipalActorWithCtx(
        contextForBackingSession({
          expirationTime: 10_000,
          userId: "auth-user",
        }) as never,
        { now: 1_000 },
      ),
    ).rejects.toThrow("service session is no longer valid");
  });

  it("rejects unbound human/demo identities from service-only guards", async () => {
    mocks.resolveServicePrincipalAuthBinding.mockRejectedValue(
      new ServicePrincipalFoundationError("auth_binding_missing"),
    );

    await expect(
      requireServicePrincipalActorWithCtx({
        auth: { getUserIdentity: vi.fn() },
      } as never),
    ).rejects.toThrow("A service session is required.");
  });
});

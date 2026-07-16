import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenericId } from "convex/values";

const mocks = vi.hoisted(() => ({
  requireServicePrincipalActorWithCtx: vi.fn(),
  resolveActiveServicePrincipalCapability: vi.fn(),
}));

vi.mock("./actor", () => ({
  requireServicePrincipalActorWithCtx:
    mocks.requireServicePrincipalActorWithCtx,
}));
vi.mock("./capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./capabilities")>()),
  resolveActiveServicePrincipalCapability:
    mocks.resolveActiveServicePrincipalCapability,
}));

import { defineServicePrincipalCapabilityCatalog } from "./capabilities";
import { requireServicePrincipalCapabilityWithCtx } from "./authorization";

const catalog = defineServicePrincipalCapabilityCatalog("fixture", [
  "fixture.application",
] as const);

const organizationId = "organization" as GenericId<"organization">;
const storeId = "store" as GenericId<"store">;

const actor = {
  kind: "service_principal" as const,
  absoluteExpiresAt: 10_000,
  authSessionId: "auth-session",
  authUserId: "auth-user",
  capabilityRevision: 3,
  consumerId: "fixture",
  idleExpiresAt: 5_000,
  organizationId,
  principalLifecycleRevision: 1,
  requiredCapabilityId: "fixture.application",
  servicePrincipalAuthBindingId: "binding",
  servicePrincipalId: "principal",
  servicePrincipalSessionId: "service-session",
  sessionRevision: 1,
  storeId,
};

const capability = {
  capabilityId: "fixture.application",
  consumerId: "fixture",
  expiresAt: undefined,
  grantId: "grant",
  organizationId,
  revision: 3,
  servicePrincipalId: "principal",
  storeId,
};

describe("service-principal authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireServicePrincipalActorWithCtx.mockResolvedValue(actor);
    mocks.resolveActiveServicePrincipalCapability.mockResolvedValue(capability);
  });

  it("reloads the exact current capability and returns scoped authority", async () => {
    await expect(
      requireServicePrincipalCapabilityWithCtx({} as never, {
        capabilityId: "fixture.application",
        catalog,
        now: 1_000,
        organizationId,
        storeId,
      }),
    ).resolves.toEqual({ actor, capability });
    expect(mocks.resolveActiveServicePrincipalCapability).toHaveBeenCalledWith(
      expect.anything(),
      {
        capabilityId: "fixture.application",
        catalog,
        consumerId: "fixture",
        now: 1_000,
        organizationId,
        servicePrincipalId: "principal",
        storeId,
      },
    );
  });

  it.each([
    ["consumer", { ...actor, consumerId: "other" }],
    ["capability", { ...actor, requiredCapabilityId: "fixture.other" }],
    ["organization", { ...actor, organizationId: "other-organization" }],
    ["store", { ...actor, storeId: "other-store" }],
  ])("denies a session with mismatched %s scope", async (_name, mismatched) => {
    mocks.requireServicePrincipalActorWithCtx.mockResolvedValue(mismatched);

    await expect(
      requireServicePrincipalCapabilityWithCtx({} as never, {
        capabilityId: "fixture.application",
        catalog,
        organizationId,
        storeId,
      }),
    ).rejects.toThrow("not authorized for this action");
    expect(mocks.resolveActiveServicePrincipalCapability).not.toHaveBeenCalled();
  });

  it("denies a session issued against an older capability revision", async () => {
    mocks.resolveActiveServicePrincipalCapability.mockResolvedValue({
      ...capability,
      revision: 4,
    });

    await expect(
      requireServicePrincipalCapabilityWithCtx({} as never, {
        capabilityId: "fixture.application",
        catalog,
      }),
    ).rejects.toThrow("not authorized for this action");
  });

  it("does not allow human or demo actors into the service guard", async () => {
    mocks.requireServicePrincipalActorWithCtx.mockRejectedValue(
      new Error("A service session is required."),
    );

    await expect(
      requireServicePrincipalCapabilityWithCtx({} as never, {
        capabilityId: "fixture.application",
        catalog,
      }),
    ).rejects.toThrow("A service session is required.");
  });
});

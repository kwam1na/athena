/// <reference types="vite/client" />

/**
 * U4 shared-demo admission, per retired demo-helper call site.
 *
 * This file drives the demo adapter directly rather than through `convexTest`
 * so it never imports the composition root: `platform/operationAdmission`
 * constructs this very adapter at module init, and loading both in one test
 * module makes the adapter observably half-initialized.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

/**
 * Cuts the one module cycle that reaches back into the composition root
 * (`sharedDemo/operationAdapter` -> `sharedDemo/restore` ->
 * `sharedDemo/openingBaseline` -> `inventory/storeSchedule` ->
 * `platform/operationAdmission` -> `sharedDemo/operationAdapter`). Every case
 * below injects its own `requireReadyWrite`, so the real restore fence is
 * never the thing under test here.
 */
vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

import { getAuthUserId } from "@convex-dev/auth/server";

import { createSharedDemoOperationAdapter } from "../sharedDemo/operationAdapter";
import {
  addOrUpdateExpenseItemOperationDefinition,
  createExpenseSessionOperationDefinition,
  createInviteCodeOperationDefinition,
  createPosSessionOperationDefinition,
  patchStoreConfigV2CommandOperationDefinition,
  removeOrganizationOperationDefinition,
  removeStoreOperationDefinition,
  sendVerificationCodeViaProviderOperationDefinition,
} from "../operationAdmission/domains/inventoryIdentity_definitions";

const DEMO_PRINCIPAL = {
  admissionExpiresAt: Number.MAX_SAFE_INTEGER,
  athenaUserId: "demo-athena-user",
  authUserId: "demo-auth-user",
  organizationId: "demo-org",
  storeId: "demo-store",
};

function demoCtx(rows: Record<string, Record<string, unknown>> = {}) {
  return {
    auth: { getUserIdentity: vi.fn() },
    db: {
      get: vi.fn(async (_table: string, id: string) => rows[id] ?? null),
      query: vi.fn(() => ({
        withIndex: vi.fn((_name: string, apply: (b: unknown) => void) => {
          apply({ eq: vi.fn().mockReturnThis() });
          return { unique: vi.fn().mockResolvedValue(DEMO_PRINCIPAL) };
        }),
      })),
    },
  };
}

describe("U4 shared-demo admission", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockResolvedValue("demo-auth-user" as never);
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it.each([
    ["posSessions:createSession", createPosSessionOperationDefinition, { storeId: "demo-store" }],
    ["stores:remove", removeStoreOperationDefinition, { id: "demo-store" }],
    [
      "stores:patchConfigV2Command",
      patchStoreConfigV2CommandOperationDefinition,
      { id: "demo-store" },
    ],
    [
      "organizations:remove",
      removeOrganizationOperationDefinition,
      { id: "demo-org" },
    ],
    [
      "inviteCode:create",
      createInviteCodeOperationDefinition,
      { organizationId: "demo-org" },
    ],
    [
      "auth:sendVerificationCodeViaProvider",
      sendVerificationCodeViaProviderOperationDefinition,
      {},
    ],
  ])("denies a demo visitor on %s with a recognized reason", async (
    _site,
    definition,
    args,
  ) => {
    await expect(
      createSharedDemoOperationAdapter({
        requireReadyWrite: vi.fn(),
      }).resolve(demoCtx() as never, args, definition),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "actor_denied",
    });
  });

  it("admits a granted expense write with the store clamp and the restore fence", async () => {
    const requireReadyWrite = vi.fn();

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite }).resolve(
        demoCtx() as never,
        { storeId: "demo-store" },
        createExpenseSessionOperationDefinition,
      ),
    ).resolves.toMatchObject({
      actor: { kind: "shared_demo", storeId: "demo-store" },
      constraints: { organizationId: "demo-org", storeId: "demo-store" },
      decision: { adapter: "shared_demo", outcome: "admitted" },
    });
    expect(requireReadyWrite).toHaveBeenCalledWith(expect.anything(), {
      expectedEpoch: undefined,
      storeId: "demo-store",
    });
  });

  // The store is derived from the named expense session, not from a client
  // argument, so a demo visitor holding another store's session id is denied
  // after scope resolution rather than admitted against their own store.
  it("denies a demo visitor across stores after resource-derived scope resolution", async () => {
    const requireReadyWrite = vi.fn();

    await expect(
      createSharedDemoOperationAdapter({ requireReadyWrite }).resolve(
        demoCtx({
          "foreign-session": { storeId: "other-store" },
        }) as never,
        { sessionId: "foreign-session" },
        addOrUpdateExpenseItemOperationDefinition,
      ),
    ).resolves.toMatchObject({
      kind: "denied",
      recognized: true,
      reason: "scope_denied",
    });
    expect(requireReadyWrite).not.toHaveBeenCalled();
  });
});


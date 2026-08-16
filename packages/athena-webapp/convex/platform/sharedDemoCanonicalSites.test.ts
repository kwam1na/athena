import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));
// The restore fence and the capture port are exercised by their own suites;
// what this file asserts is that the DEFAULT chain evaluates a shared-demo
// principal at each canonical call site, per the definition's `sharedDemo`
// field.
vi.mock("../sharedDemo/restore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sharedDemo/restore")>();
  return { ...actual, requireReadySharedDemoWriteWithCtx: vi.fn() };
});
vi.mock("../contextTracking/sharedDemoActionCapture", () => ({
  captureSharedDemoAdmittedActionWithCtx: vi.fn(),
}));

import { getAuthUserId } from "@convex-dev/auth/server";

import {
  bindRegisterBaselineToTerminalOperationDefinition,
  decideApprovalRequestOperationDefinition,
  requestManualRestoreOperationDefinition,
  resetBrowserExperienceOperationDefinition,
  resolveSyncedSaleInventoryReviewGroupOperationDefinition,
} from "../operationAdmission/definitions";
import { admitPublicMutation } from "./operationAdmission";

const DEMO_STORE = "demo-store";
const DEMO_ORG = "demo-org";

/**
 * A ctx that resolves a live shared-demo principal, plus whatever rows the
 * per-definition scope resolvers load. `getAuthUserId` returns the demo auth
 * user, so a chain that skipped the demo adapter would resolve this caller as
 * a normal user instead — which is exactly what these cases rule out.
 */
function demoPrincipalCtx(rows: Record<string, unknown> = {}) {
  return {
    auth: { getUserIdentity: vi.fn() },
    db: {
      get: vi.fn(async (table: string) =>
        table in rows ? rows[table] : { _id: "demo-athena-user" },
      ),
      query: vi.fn(() => ({
        withIndex: vi.fn((_name: string, apply: Function) => {
          apply({ eq: vi.fn().mockReturnThis() });
          return {
            unique: vi.fn().mockResolvedValue({
              admissionExpiresAt: Date.now() + 60_000,
              athenaUserId: "demo-athena-user",
              authUserId: "demo-auth-user",
              organizationId: DEMO_ORG,
              storeId: DEMO_STORE,
            }),
          };
        }),
      })),
    },
  };
}

/**
 * Every call site that already used the canonical wrapper before the rename,
 * with the arguments its scope resolver reads. Each definition declares
 * `sharedDemo: "admit"`, so each must reach its handler with a `shared_demo`
 * actor and the principal's own store clamped onto the admission.
 */
const demoAdmittedSites = [
  {
    args: { expectedDemoRestoreEpoch: 3, storeId: DEMO_STORE },
    definition: resolveSyncedSaleInventoryReviewGroupOperationDefinition,
    rows: {},
  },
  {
    args: { approvalRequestId: "approval-1", decision: "approved" },
    definition: decideApprovalRequestOperationDefinition,
    rows: {
      approvalRequest: {
        _id: "approval-1",
        organizationId: DEMO_ORG,
        storeId: DEMO_STORE,
      },
    },
  },
  {
    args: { idempotencyKey: "restore-key-0001" },
    definition: requestManualRestoreOperationDefinition,
    rows: {},
  },
  {
    args: { terminalId: "terminal-1" },
    definition: resetBrowserExperienceOperationDefinition,
    rows: { posTerminal: { _id: "terminal-1", storeId: DEMO_STORE } },
  },
  {
    args: { expectedEpoch: 3, terminalId: "terminal-1" },
    definition: bindRegisterBaselineToTerminalOperationDefinition,
    rows: { posTerminal: { _id: "terminal-1", storeId: DEMO_STORE } },
  },
] as const;

describe("canonical call sites under a shared-demo principal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
    vi.mocked(getAuthUserId).mockResolvedValue("demo-auth-user" as never);
  });

  it.each(demoAdmittedSites.map((site) => [site.definition.operationId, site]))(
    "%s admits the demo principal and clamps to its own store",
    async (_operationId, site) => {
      const admitted = await admitPublicMutation(
        site.definition,
        async (ctx) => ctx.operationAdmission,
      )(demoPrincipalCtx(site.rows) as never, { ...site.args } as never);

      expect(admitted.actor.kind).toBe("shared_demo");
      expect(admitted.decision).toEqual({
        adapter: "shared_demo",
        outcome: "admitted",
      });
      expect(admitted.constraints.storeId).toBe(DEMO_STORE);
    },
  );

  it.each(demoAdmittedSites.map((site) => [site.definition.operationId, site]))(
    "%s denies the demo principal when the definition flips to sharedDemo:deny",
    async (_operationId, site) => {
      const handler = vi.fn();

      // The same definition with the one field changed: the demo adapter is
      // what decides, so flipping the declaration must flip the outcome
      // without touching the call site.
      await expect(
        admitPublicMutation(
          { ...site.definition, actors: { ...site.definition.actors, sharedDemo: "deny" } },
          handler,
        )(demoPrincipalCtx(site.rows) as never, { ...site.args } as never),
      ).rejects.toThrow();
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("denies a demo principal whose store does not match the targeted row", async () => {
    const handler = vi.fn();

    await expect(
      admitPublicMutation(
        decideApprovalRequestOperationDefinition,
        handler,
      )(
        demoPrincipalCtx({
          approvalRequest: {
            _id: "approval-1",
            organizationId: DEMO_ORG,
            storeId: "another-store",
          },
        }) as never,
        { approvalRequestId: "approval-1", decision: "approved" } as never,
      ),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});

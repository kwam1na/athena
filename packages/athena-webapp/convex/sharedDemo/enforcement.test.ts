import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));
vi.mock("./actor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actor")>();
  return {
    ...actual,
    requireSharedDemoCapabilityIfApplicable: vi.fn(),
    requireReadySharedDemoStoreCapabilityIfApplicable: vi.fn(),
    requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
  };
});
vi.mock("./restore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./restore")>();
  return { ...actual, requireReadySharedDemoWriteWithCtx: vi.fn() };
});
/**
 * Most cases here assert a handler's OWN inner shared-demo guard, so the
 * admission wrapper is bypassed for them and the handler is invoked directly.
 * `decideApprovalRequest` is the exception: what that case asserts is the
 * rail's store clamp and restore fence, so it runs through the real canonical
 * wrapper. Before the canonical rename this split rode on two wrapper names;
 * now that there is one name, it rides on the operation id.
 */
vi.mock("../platform/operationAdmission", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../platform/operationAdmission")>();
  const admittedThroughTheRealRail = new Set([
    "operations/approvalRequests.decideApprovalRequest",
  ]);
  return {
    ...actual,
    admitPublicMutation: (
      definition: { operationId: string },
      handler: Function,
      options?: unknown,
    ) =>
      admittedThroughTheRealRail.has(definition.operationId)
        ? actual.admitPublicMutation(
            definition as never,
            handler as never,
            options as never,
          )
        : handler,
  };
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getAuthUserId } from "@convex-dev/auth/server";
import {
  requireReadySharedDemoStoreCapabilityIfApplicable,
  requireSharedDemoCapabilityIfApplicable,
  requireSharedDemoStoreCapabilityIfApplicable,
} from "./actor";
import { requireReadySharedDemoWriteWithCtx } from "./restore";
import { classifySharedDemoExternalGateway } from "./policy";
import { OPERATION_ADMISSION_DEFINITIONS } from "../operationAdmission/definitions";
import { remove as removeStore } from "../inventory/stores";
import { decideApprovalRequest } from "../operations/approvalRequests";
import { processReturnExchange } from "../storeFront/onlineOrder";

/** The handler-local demo guards this migration retired. */
const RETIRED_HANDLER_GUARDS = [
  "requireSharedDemoCapabilityIfApplicable",
  "requireSharedDemoStoreCapabilityIfApplicable",
  "enforceSharedDemoActionCapability",
  "denySharedDemoEffectIfApplicable",
  "requireAuthenticatedNonDemoEffect",
] as const;

/**
 * Module source with comments removed.
 *
 * The migrated modules deliberately keep `// Retired: ...` comments naming the
 * guard each definition replaced; a naive substring check would read those as
 * live call sites.
 */
function strippedSource(relativePath: string) {
  return readFileSync(resolve(__dirname, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const invoke = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(
    ctx,
    args,
  );

describe("actual public shared-demo enforcement boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);
  });

  /**
   * These six used to be asserted by mocking `requireSharedDemoCapabilityIfApplicable`
   * and checking the handler called it before touching `ctx.db`. That guard is
   * retired: the denial now happens in the rail, before the handler is entered
   * at all, so there is no in-handler call left to observe and the old shape
   * could only be kept alive by re-adding the guard it was written to police.
   *
   * The successor fact is the declaration — `actors.sharedDemo: "deny"` on the
   * operation — plus the absence of the retired identifier from the module.
   * Runtime denial through the real rail is covered per-function by the unit
   * admission suites (`inventoryIdentityAdmission.test.ts`,
   * `operationsAdmission.test.ts`).
   */
  it.each([
    [
      "operations/staffCredentials:createStaffCredential",
      "identity.manage",
    ],
    ["inventory/inviteCode:create", "permissions.manage"],
    ["inventory/stores:remove", "administration.destructive"],
    ["inventory/stores:patchConfigV2Command", "integrations.manage"],
    ["operations/staffProfiles:createStaffProfile", "staff.manage"],
    ["operations/staffProfiles:updateStaffProfile", "staff.manage"],
  ] as const)(
    "denies a representative actual function at the rail, not in the handler",
    (functionName, capability) => {
      const definition = OPERATION_ADMISSION_DEFINITIONS.find(
        (candidate) => candidate.functionName === functionName,
      );
      expect(definition, functionName).toBeDefined();
      expect(definition?.capability, functionName).toBe(capability);
      expect(definition?.actors.sharedDemo, functionName).toBe("deny");

      const [moduleName] = functionName.split(":");
      const code = strippedSource(`../${moduleName}.ts`);
      for (const retired of RETIRED_HANDLER_GUARDS) {
        expect(code, `${moduleName} still calls ${retired}`).not.toContain(
          `${retired}(`,
        );
      }
    },
  );

  it("routes demo return and exchange writes through the loaded order store clamp", async () => {
    const sentinel = new Error("boundary reached");
    vi.mocked(
      requireReadySharedDemoStoreCapabilityIfApplicable,
    ).mockRejectedValueOnce(sentinel);
    const ctx = {
      db: {
        get: vi.fn(async () => ({ _id: "order", storeId: "store" })),
      },
    };

    await expect(
      invoke(processReturnExchange, ctx, { orderId: "order" }),
    ).rejects.toThrow(sentinel.message);
    expect(
      requireReadySharedDemoStoreCapabilityIfApplicable,
    ).toHaveBeenCalledWith(
      ctx,
      "payments.refund",
      "store",
    );
  });

  /**
   * The payment actions used to open with a `ctx.runQuery` into
   * `enforceSharedDemoActionCapability`, and this asserted that the query ran
   * before any provider or mutation work. Both call sites are retired.
   *
   * The successor is stronger, because it is a property of the declaration
   * rather than of one handler's statement order: a payment action is either
   * demo-denied outright, or it is demo-admitted and every external gateway it
   * binds classifies as `simulated`. Either way a demo principal cannot reach
   * a live payment provider — which is what the old ordering assertion was
   * protecting.
   */
  it("keeps every payment operation away from a live provider in the demo", () => {
    // Enumerated from the definitions, not hand-listed: this delivery deleted
    // three route-only payment exports, and a hard-coded list would have gone
    // stale the moment they went.
    const paymentOperations = OPERATION_ADMISSION_DEFINITIONS.filter(
      (definition) =>
        definition.functionName?.startsWith("storeFront/payment:") ||
        definition.functionName?.startsWith("storeFront/paystackActions:"),
    );
    expect(paymentOperations.length).toBeGreaterThan(0);

    for (const definition of paymentOperations) {
      const name = definition.functionName!;
      // Every payment operation names the provider gateway it can reach, so
      // "can the demo reach a live provider?" is answerable from declarations.
      expect(definition.effects.mode, name).toBe("protected");
      const gateways =
        definition.effects.mode === "protected"
          ? definition.effects.gateways
          : [];
      expect(gateways.length, name).toBeGreaterThan(0);

      if (definition.actors.sharedDemo !== "admit") continue;
      for (const gateway of gateways) {
        expect(
          classifySharedDemoExternalGateway(gateway).decision,
          `${name} -> ${gateway}`,
        ).toBe("simulated");
      }
    }
  });

  it("leaves no retired demo guard behind in the payment module", () => {
    const code = strippedSource("../storeFront/payment.ts");
    for (const retired of RETIRED_HANDLER_GUARDS) {
      expect(code, retired).not.toContain(`${retired}(`);
    }
  });

  it("preserves the existing normal store-removal behavior", async () => {
    vi.mocked(requireSharedDemoCapabilityIfApplicable).mockResolvedValueOnce(null);
    // Store removal now sweeps the weekly reporting tables first; an empty
    // weekly universe keeps the removal single-mutation.
    const emptyWeeklyQuery = {
      withIndex: vi.fn().mockReturnThis(),
      unique: vi.fn().mockResolvedValue(null),
      take: vi.fn().mockResolvedValue([]),
    };
    const ctx = {
      db: {
        delete: vi.fn(),
        get: vi.fn().mockResolvedValue({ _id: "store" }),
        query: vi.fn().mockReturnValue(emptyWeeklyQuery),
      },
    };
    await expect(invoke(removeStore, ctx, { id: "store" })).resolves.toEqual({
      message: "OK",
    });
    expect(ctx.db.delete).toHaveBeenCalledWith("store", "store");
  });

  it("clamps and fences approval decisions to the request's demo store", async () => {
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
    vi.mocked(getAuthUserId).mockResolvedValue("auth-demo" as never);
    const sentinel = new Error("restore fence reached");
    vi.mocked(requireReadySharedDemoWriteWithCtx).mockRejectedValueOnce(sentinel);
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "approvalRequest" && id === "approval") {
            return {
              _id: "approval",
              organizationId: "org",
              status: "pending",
              storeId: "store",
            };
          }
          return null;
        }),
        insert: vi.fn(),
        patch: vi.fn(),
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, apply: Function) => {
            apply({ eq: vi.fn().mockReturnThis() });
            return {
              unique: vi.fn(async () =>
                table === "sharedDemoPrincipal"
                  ? {
                      admissionExpiresAt: Date.now() + 60_000,
                      athenaUserId: "demo-athena",
                      authUserId: "auth-demo",
                      organizationId: "org",
                      storeId: "store",
                    }
                  : null,
              ),
            };
          }),
        })),
      },
    };

    await expect(
      invoke(decideApprovalRequest, ctx, {
        approvalRequestId: "approval",
        decision: "approved",
      }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(requireSharedDemoStoreCapabilityIfApplicable).not.toHaveBeenCalled();
    expect(requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(ctx, {
      storeId: "store",
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

});

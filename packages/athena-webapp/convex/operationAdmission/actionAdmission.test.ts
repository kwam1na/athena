import { describe, expect, it, vi } from "vitest";

import {
  admitActionOperationWithCtx,
  findOperationDefinition,
} from "./actionAdmission";

const demoAdmission = {
  actor: {
    kind: "shared_demo" as const,
    authUserId: "users_visitor_1",
    athenaUserId: "athenaUser_demo",
    organizationId: "organization_demo",
    storeId: "store_demo",
  },
  constraints: { storeId: "store_demo" },
  decision: { adapter: "shared_demo" as const, outcome: "admitted" as const },
  operationId: "storeFront/reviews.sendFeedbackRequest",
  provenance: {},
};

describe("operation definition lookup", () => {
  it("finds the action definitions by operation id", () => {
    for (const operationId of [
      "storeFront/onlineOrderUtilFns.sendOrderUpdateEmail",
      "storeFront/reviews.sendFeedbackRequest",
    ]) {
      const definition = findOperationDefinition(operationId);

      expect(definition, operationId).toBeDefined();
      expect(definition!.actors.sharedDemo, operationId).toBe("admit");
      // Both send customer email, so both must declare a protected gateway
      // for the demo adapter to simulate rather than deny.
      expect(definition!.effects.mode, operationId).toBe("protected");
      // An action is not transactional: it fences on store_ready at admission
      // and the internal mutation that writes re-applies store_write.
      expect(definition!.kind, operationId).toBe("action");
      expect(definition!.readiness.kind, operationId).toBe("store_ready");
    }
  });
});

describe("admitting an operation from an action", () => {
  it("reports the admitted actor so the caller can simulate demo effects", async () => {
    const result = await admitActionOperationWithCtx(
      {} as never,
      {
        operationId: "storeFront/reviews.sendFeedbackRequest",
        operationArgs: { orderId: "order_1" },
      },
      { admit: vi.fn().mockResolvedValue(demoAdmission) },
    );

    expect(result).toEqual({
      actorKind: "shared_demo",
      storeId: "store_demo",
    });
  });

  it("propagates a denial instead of letting the action proceed", async () => {
    await expect(
      admitActionOperationWithCtx(
        {} as never,
        {
          operationId: "storeFront/reviews.sendFeedbackRequest",
          operationArgs: {},
        },
        {
          admit: vi
            .fn()
            .mockRejectedValue(
              new Error("This action isn't allowed in the demo."),
            ),
        },
      ),
    ).rejects.toThrow("This action isn't allowed in the demo.");
  });
});

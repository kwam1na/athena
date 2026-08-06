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
  operation: {
    operationId: "storeFront/reviews.sendFeedbackRequest",
    capability: "reviews.manage",
  },
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
      {
        capture: vi.fn(),
        resolveAdmission: vi.fn().mockResolvedValue(demoAdmission),
      },
    );

    expect(result).toEqual({
      actorKind: "shared_demo",
      storeId: "store_demo",
    });
  });

  it("records the admitted action so demo visibility covers action writes", async () => {
    const capture = vi.fn();

    await admitActionOperationWithCtx(
      {} as never,
      {
        operationId: "storeFront/reviews.sendFeedbackRequest",
        operationArgs: {},
      },
      { capture, resolveAdmission: vi.fn().mockResolvedValue(demoAdmission) },
    );

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]).toBe(demoAdmission);
  });

  it("refuses an operation id that has no definition", async () => {
    await expect(
      admitActionOperationWithCtx(
        {} as never,
        { operationId: "storeFront/reviews.notARealOperation", operationArgs: {} },
        { capture: vi.fn(), resolveAdmission: vi.fn() },
      ),
    ).rejects.toThrow(/Unknown operation admission definition/);
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
          capture: vi.fn(),
          resolveAdmission: vi
            .fn()
            .mockRejectedValue(new Error("This action isn't allowed in the demo.")),
        },
      ),
    ).rejects.toThrow("This action isn't allowed in the demo.");
  });
});

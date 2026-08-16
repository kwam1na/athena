import { describe, expect, it, vi } from "vitest";

import { findOperationDefinition } from "../operationAdmission/rail";
import {
  sendFeedbackRequestOperationDefinition,
  sendOrderUpdateEmailOperationDefinition,
} from "../operationAdmission/definitions";
import { admitPublicAction } from "./operationAdmission";

const demoAdmissionProjection = {
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

describe("action operation definitions", () => {
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

  it("keeps the two adopted call sites bound to those definitions", () => {
    expect(sendOrderUpdateEmailOperationDefinition.operationId).toBe(
      "storeFront/onlineOrderUtilFns.sendOrderUpdateEmail",
    );
    expect(sendFeedbackRequestOperationDefinition.operationId).toBe(
      "storeFront/reviews.sendFeedbackRequest",
    );
  });
});

describe("admitPublicAction", () => {
  it("admits through the registered internal mutation and hands the handler the projection", async () => {
    const runMutation = vi.fn().mockResolvedValue(demoAdmissionProjection);
    const handler = vi.fn(async (ctx: { operationAdmission: unknown }) => ctx.operationAdmission);

    const wrapped = admitPublicAction(
      sendFeedbackRequestOperationDefinition,
      handler as never,
    );

    await expect(
      wrapped({ runMutation } as never, { orderId: "order_1" } as never),
    ).resolves.toEqual(demoAdmissionProjection);

    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      operationId: "storeFront/reviews.sendFeedbackRequest",
      operationArgs: { orderId: "order_1" },
    });
  });

  it("propagates a denial instead of letting the action body run", async () => {
    const runMutation = vi
      .fn()
      .mockRejectedValue(new Error("This action isn't allowed in the demo."));
    const handler = vi.fn();

    await expect(
      admitPublicAction(
        sendFeedbackRequestOperationDefinition,
        handler as never,
      )({ runMutation } as never, {} as never),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(handler).not.toHaveBeenCalled();
  });
});

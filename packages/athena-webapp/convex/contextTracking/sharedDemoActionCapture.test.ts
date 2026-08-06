import { describe, expect, it, vi } from "vitest";

import {
  buildSharedDemoActionAppendArgs,
  captureSharedDemoAdmittedActionWithCtx,
} from "./sharedDemoActionCapture";

const now = 1_760_000_000_000;

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
    operationId: "pos/public/transactions.completeTransaction",
    capability: "pos.sale.complete",
  },
  provenance: {},
};

const normalAdmission = {
  ...demoAdmission,
  actor: { kind: "normal_user" as const, athenaUserId: "athenaUser_real" },
  decision: { adapter: "normal_user" as const, outcome: "admitted" as const },
};

describe("shared demo action append args", () => {
  it("records the operation and capability against the visitor's auth user", () => {
    const args = buildSharedDemoActionAppendArgs(demoAdmission as never, now);

    expect(args).toMatchObject({
      surface: "shared_demo",
      eventId: "shared_demo.action_admitted",
      schemaVersion: 1,
      storeId: "store_demo",
      organizationId: "organization_demo",
      payload: {
        operationId: "pos/public/transactions.completeTransaction",
        capability: "pos.sale.complete",
      },
      actorRef: { kind: "guest", id: "users_visitor_1" },
      visibilityMode: "support",
      nonCompilable: true,
    });
  });

  it("keys each occurrence separately so repeated actions are all counted", () => {
    const first = buildSharedDemoActionAppendArgs(demoAdmission as never, now);
    const second = buildSharedDemoActionAppendArgs(
      demoAdmission as never,
      now + 1,
    );

    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });
});

describe("capturing an admitted demo action", () => {
  it("ignores admissions that are not shared demo", async () => {
    const append = vi.fn();

    await captureSharedDemoAdmittedActionWithCtx(
      {} as never,
      normalAdmission as never,
      { append, now },
    );

    expect(append).not.toHaveBeenCalled();
  });

  it("appends exactly one event for an admitted demo action", async () => {
    const append = vi.fn().mockResolvedValue({ kind: "recorded" });

    await captureSharedDemoAdmittedActionWithCtx(
      {} as never,
      demoAdmission as never,
      { append, now },
    );

    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1]).toMatchObject({
      eventId: "shared_demo.action_admitted",
    });
  });

  it("never lets a telemetry failure break the operation it observes", async () => {
    const append = vi.fn().mockRejectedValue(new Error("quota exhausted"));

    await expect(
      captureSharedDemoAdmittedActionWithCtx(
        {} as never,
        demoAdmission as never,
        { append, now },
      ),
    ).resolves.toBeUndefined();
  });
});

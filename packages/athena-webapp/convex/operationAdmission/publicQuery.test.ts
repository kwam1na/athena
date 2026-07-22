import { describe, expect, it, vi } from "vitest";

import { defineReadOperation } from "./readDefinitions";
import { admitPublicQuery } from "./publicQuery";

const definition = defineReadOperation({
  operationId: "test.read",
  access: { kind: "read", intent: "test.view" },
  scope: { kind: "store", storeIdArg: "storeId" },
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

describe("operation admission public query wrapper", () => {
  it("resolves read admission before invoking the domain handler and preserves output", async () => {
    const domainHandler = vi.fn(async (_ctx, args) => ({
      kind: "ok",
      data: { storeId: args.storeId },
    }));
    const resolveAdmission = vi.fn(async () => ({
      actor: { kind: "normal_user" as const, athenaUserId: "user-1" as never },
      constraints: {
        organizationId: "org-1" as never,
        storeId: "store-1" as never,
      },
      decision: {
        adapter: "normal_user" as const,
        outcome: "admitted" as const,
      },
      operation: definition,
      provenance: { kind: "normal_user" },
    }));

    const wrapped = admitPublicQuery(definition, domainHandler, {
      resolveAdmission,
    });
    await expect(
      wrapped({ db: {} } as never, { storeId: "store-1" }),
    ).resolves.toEqual({ kind: "ok", data: { storeId: "store-1" } });

    expect(resolveAdmission).toHaveBeenCalledBefore(domainHandler);
    expect(domainHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        operationAdmission: expect.objectContaining({
          actor: { kind: "normal_user", athenaUserId: "user-1" },
          operation: definition,
        }),
      }),
      { storeId: "store-1" },
    );
  });

  it("does not invoke the domain handler when read admission metadata is invalid", async () => {
    const domainHandler = vi.fn();
    const wrapped = admitPublicQuery(
      { ...definition, access: { kind: "read", intent: "" } },
      domainHandler,
      {
        resolveAdmission: vi.fn(),
      },
    );

    await expect(
      wrapped({ db: {} } as never, { storeId: "store-1" }),
    ).rejects.toThrow("Invalid operation read admission definition");
    expect(domainHandler).not.toHaveBeenCalled();
  });
});

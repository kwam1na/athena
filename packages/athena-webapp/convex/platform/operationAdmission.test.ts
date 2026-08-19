import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));

import { getAuthUserId } from "@convex-dev/auth/server";

import { defineOperation } from "../operationAdmission/domains/_shapes";
import type { OperationDefinition } from "../operationAdmission/types";
import { admitPublicMutation } from "./operationAdmission";

const demoDeniedDefinition = defineOperation({
  kind: "mutation" as const,
  operationId: "test.compositionRoot.demoDenied",
  capability: "inventory.import",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
}) as OperationDefinition;

function demoPrincipalCtx() {
  return {
    auth: { getUserIdentity: vi.fn() },
    db: {
      get: vi.fn(async () => ({ _id: "demo-athena-user" })),
      query: vi.fn(() => ({
        withIndex: vi.fn((_name: string, apply: Function) => {
          apply({ eq: vi.fn().mockReturnThis() });
          return {
            unique: vi.fn().mockResolvedValue({
              admissionExpiresAt: Date.now() + 60_000,
              athenaUserId: "demo-athena-user",
              authUserId: "demo-auth-user",
              organizationId: "demo-org",
              storeId: "demo-store",
            }),
          };
        }),
      })),
    },
  };
}

describe("composition root default adapter chain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
  });

  it("denies a demo principal on a sharedDemo:deny definition instead of admitting it as a normal user", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("demo-auth-user" as never);
    const handler = vi.fn();

    await expect(
      admitPublicMutation(
        demoDeniedDefinition,
        handler,
      )(demoPrincipalCtx() as never, { storeId: "demo-store" }),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("admits a normal authenticated user unchanged", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        get: vi.fn(async (table: string) =>
          table === "users" ? { email: "admin@example.com" } : null,
        ),
        query: vi.fn(() => ({
          withIndex: vi.fn((_name: string, apply: Function) => {
            apply({ eq: vi.fn().mockReturnThis() });
            return {
              first: vi.fn().mockResolvedValue(null),
              take: vi
                .fn()
                .mockResolvedValue([
                  { _id: "athena-user", normalizedEmail: "admin@example.com" },
                ]),
              unique: vi.fn().mockResolvedValue(null),
            };
          }),
        })),
      },
    };

    await expect(
      admitPublicMutation(demoDeniedDefinition, async (handlerCtx) =>
        handlerCtx.operationAdmission.actor,
      )(ctx as never, { storeId: "store-1" }),
    ).resolves.toEqual({ kind: "normal_user", athenaUserId: "athena-user" });
  });
});

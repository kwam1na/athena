import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

import { requireStoreFullAdminAccess } from "./access";

function createStockOpsAccessQueryCtx(args: {
  athenaUserEmail?: string;
  authUserEmail?: string;
  authUserId?: string | null;
  role: "full_admin" | "pos_only";
}) {
  const store = {
    _id: "store-1",
    organizationId: "org-1",
  };
  const athenaUser =
    args.athenaUserEmail === undefined
      ? null
      : {
          _id: "athena-user-1",
          email: args.athenaUserEmail,
        };

  const membership =
    args.role === "full_admin"
      ? {
          _id: "membership-1",
          organizationId: "org-1",
          role: "full_admin" as const,
          userId: "athena-user-1",
        }
      : {
          _id: "membership-1",
          organizationId: "org-1",
          role: "pos_only" as const,
          userId: "athena-user-1",
      };

  mockedAuthServer.getAuthUserId.mockResolvedValue(args.authUserId ?? null);

  const ctx = {
    auth: {},
    db: {
      get(_table: string, id: string) {
        if (id === "store-1") {
          return Promise.resolve(store);
        }

        if (id === "auth-user-1") {
          return Promise.resolve(
            args.authUserEmail
              ? {
                  _id: "auth-user-1",
                  email: args.authUserEmail,
                }
              : null
          );
        }

        return Promise.resolve(null);
      },
      query(table: string) {
        if (table === "athenaUser") {
          return {
            filter(
              applyFilter: (queryBuilder: {
                eq: (left: unknown, right: unknown) => unknown;
                field: (name: string) => string;
              }) => unknown
            ) {
              const queryBuilder = {
                eq: (left: unknown, right: unknown) => ({ left, right }),
                field: (name: string) => name,
              };

              applyFilter(queryBuilder);

              return {
                first() {
                  return Promise.resolve(athenaUser);
                },
              };
            },
          };
        }

        if (table !== "organizationMember") {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          filter(
            applyFilter: (queryBuilder: {
              and: (...conditions: unknown[]) => unknown;
              eq: (left: unknown, right: unknown) => unknown;
              field: (name: string) => string;
            }) => unknown
          ) {
            const queryBuilder = {
              and: (...conditions: unknown[]) => conditions,
              eq: (left: unknown, right: unknown) => ({ left, right }),
              field: (name: string) => name,
            };

            applyFilter(queryBuilder);

            return {
              first() {
                return Promise.resolve(membership);
              },
            };
          },
        };
      },
    },
  } as unknown as QueryCtx;

  return ctx;
}

describe("stock ops access", () => {
  it("requires an authenticated user", async () => {
    const ctx = createStockOpsAccessQueryCtx({
      authUserEmail: "manager@example.com",
      authUserId: null,
      role: "full_admin",
    });

    await expect(
      requireStoreFullAdminAccess(ctx, "store-1" as Id<"store">)
    ).rejects.toThrow("Authentication required.");
  });

  it("requires a matching Athena user record", async () => {
    const ctx = createStockOpsAccessQueryCtx({
      authUserEmail: "manager@example.com",
      authUserId: "auth-user-1",
      role: "full_admin",
      athenaUserEmail: undefined,
    });

    await expect(
      requireStoreFullAdminAccess(ctx, "store-1" as Id<"store">)
    ).rejects.toThrow("Athena user not found.");
  });

  it("requires full-admin membership for the store organization", async () => {
    const ctx = createStockOpsAccessQueryCtx({
      authUserEmail: "manager@example.com",
      authUserId: "auth-user-1",
      role: "pos_only",
      athenaUserEmail: "manager@example.com",
    });

    await expect(
      requireStoreFullAdminAccess(ctx, "store-1" as Id<"store">)
    ).rejects.toThrow("Only full admins can access stock operations.");
  });

  it("returns the store and user for full-admin members", async () => {
    const ctx = createStockOpsAccessQueryCtx({
      authUserEmail: "manager@example.com",
      authUserId: "auth-user-1",
      role: "full_admin",
      athenaUserEmail: "manager@example.com",
    });

    await expect(
      requireStoreFullAdminAccess(ctx, "store-1" as Id<"store">)
    ).resolves.toMatchObject({
      athenaUser: {
        _id: "athena-user-1",
        email: "manager@example.com",
      },
      store: {
        _id: "store-1",
        organizationId: "org-1",
      },
    });
  });
});

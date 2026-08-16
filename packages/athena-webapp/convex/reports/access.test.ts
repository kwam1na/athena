import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import { requireReportsStoreAccess } from "./access";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));

/**
 * Ported from convex/reporting/access.test.ts — same fixtures, same
 * fail-closed assertions, retargeted at requireReportsStoreAccess.
 *
 * The shared-demo half of this gate moved to the admission rail in U8 (see
 * `operationAdmission/domains/u8_reports_readDefinitions.ts`), so the gate now
 * has exactly one dependency: "who is the authenticated Athena user", which
 * the rail answers for a demo principal and a normal user alike. The
 * membership rule below is unchanged and still applies to both.
 */

function context(args: {
  duplicateMembership?: boolean;
  role?: "full_admin" | "pos_only";
  storeOrganizationId?: string;
}) {
  const store =
    args.storeOrganizationId === undefined
      ? null
      : {
          _id: "store-1" as Id<"store">,
          organizationId: args.storeOrganizationId as Id<"organization">,
        };

  return {
    db: {
      get: vi.fn(async () => store),
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          take: vi.fn(async () =>
            args.role
              ? Array.from(
                  { length: args.duplicateMembership ? 2 : 1 },
                  () => ({
                    userId: "user-1",
                    organizationId: store?.organizationId,
                    role: args.role,
                  }),
                )
              : [],
          ),
        })),
      })),
    },
  };
}

describe("reports access", () => {
  beforeEach(() => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _id: "user-1" as Id<"athenaUser">,
      email: "admin@example.com",
      normalizedEmail: "admin@example.com",
      _creationTime: 1,
    });
  });

  it("returns a store only for an active full admin in the owning organization", async () => {
    const result = await requireReportsStoreAccess(
      context({ role: "full_admin", storeOrganizationId: "org-1" }) as never,
      "store-1" as Id<"store">,
    );

    expect(result).toMatchObject({
      store: { _id: "store-1", organizationId: "org-1" },
      athenaUser: { _id: "user-1" },
    });
  });

  it("collapses an identity failure into the same opaque denial", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockRejectedValueOnce(new Error("SECRET_INTERNAL_DETAIL"));
    await expect(
      requireReportsStoreAccess(
        context({ role: "full_admin", storeOrganizationId: "org-1" }) as never,
        "store-1" as Id<"store">,
      ),
    ).rejects.toThrow("Reports access unavailable.");
  });

  it.each([
    { role: "pos_only" as const, storeOrganizationId: "org-1" },
    { role: undefined, storeOrganizationId: "org-2" },
    { role: undefined, storeOrganizationId: undefined },
  ])(
    "does not distinguish missing, foreign, or insufficient access",
    async (args) => {
      await expect(
        requireReportsStoreAccess(
          context(args) as never,
          "store-1" as Id<"store">,
        ),
      ).rejects.toThrow("Reports access unavailable.");
    },
  );

  it("fails closed when duplicate full-admin memberships exist", async () => {
    await expect(
      requireReportsStoreAccess(
        context({
          duplicateMembership: true,
          role: "full_admin",
          storeOrganizationId: "org-1",
        }) as never,
        "store-1" as Id<"store">,
      ),
    ).rejects.toThrow("Reports access unavailable.");
  });
});

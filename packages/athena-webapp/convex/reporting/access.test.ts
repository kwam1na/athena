import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import { requireReportingStoreAccess } from "./access";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));
vi.mock("../sharedDemo/actor", () => ({
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));

import { requireSharedDemoStoreCapabilityIfApplicable } from "../sharedDemo/actor";

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

describe("reporting access", () => {
  beforeEach(() => {
    vi.mocked(requireSharedDemoStoreCapabilityIfApplicable).mockResolvedValue(null);
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
    const result = await requireReportingStoreAccess(
      context({ role: "full_admin", storeOrganizationId: "org-1" }) as never,
      "store-1" as Id<"store">,
    );

    expect(result).toMatchObject({
      store: { _id: "store-1", organizationId: "org-1" },
      athenaUser: { _id: "user-1" },
    });
    expect(requireSharedDemoStoreCapabilityIfApplicable).toHaveBeenCalledWith(
      expect.anything(),
      "reports.read",
      "store-1",
    );
  });

  it("fails closed before reading a report for another store", async () => {
    vi.mocked(requireSharedDemoStoreCapabilityIfApplicable).mockRejectedValueOnce(
      new Error("This action is unavailable in the shared demo."),
    );
    await expect(
      requireReportingStoreAccess(
        context({ role: "full_admin", storeOrganizationId: "org-1" }) as never,
        "other-store" as Id<"store">,
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
        requireReportingStoreAccess(
          context(args) as never,
          "store-1" as Id<"store">,
        ),
      ).rejects.toThrow("Reports access unavailable.");
    },
  );

  it("fails closed when duplicate full-admin memberships exist", async () => {
    await expect(
      requireReportingStoreAccess(
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

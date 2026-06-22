import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as athenaUserAuth from "../lib/athenaUserAuth";
import {
  get,
  getPublicActive,
  presentPublicBannerMessage,
  remove,
  upsert,
} from "./bannerMessage";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("public banner message presentation", () => {
  const bannerDocument = {
    _id: "banner-1",
    _creationTime: 1,
    storeId: "store-1",
    heading: "Summer drop",
    message: "New arrivals are live.",
    active: true,
    countdownEndsAt: 2_000,
  };

  beforeEach(() => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({
      _id: "athena-user-1",
      email: "admin@example.com",
    } as any);
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue({ _id: "member-1", role: "full_admin" } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns active displayable banner content", () => {
    const presented = presentPublicBannerMessage(bannerDocument, 1_000);

    expect(presented).toEqual({
      heading: "Summer drop",
      message: "New arrivals are live.",
      countdownEndsAt: 2_000,
    });
    expect(() => assertConformsToExportedReturns(getPublicActive, presented)).not.toThrow();
  });

  it("returns null for inactive blank or expired rows without diagnostics", () => {
    expect(
      presentPublicBannerMessage(
        {
          _id: "banner-inactive",
          heading: "Draft",
          message: "Not public",
          active: false,
        },
        1_000,
      ),
    ).toBeNull();

    expect(
      presentPublicBannerMessage(
        {
          _id: "banner-blank",
          heading: "  ",
          message: "",
          active: true,
        },
        1_000,
      ),
    ).toBeNull();

    expect(
      presentPublicBannerMessage(
        {
          _id: "banner-expired",
          heading: "Done",
          active: true,
          countdownEndsAt: 999,
        },
        1_000,
      ),
    ).toBeNull();
  });

  it("keeps changed banner return validators aligned with representative values", () => {
    expect(() => assertConformsToExportedReturns(get, bannerDocument)).not.toThrow();
    expect(() => assertConformsToExportedReturns(get, null)).not.toThrow();
    expect(() => assertConformsToExportedReturns(upsert, bannerDocument)).not.toThrow();
    expect(() => assertConformsToExportedReturns(remove, true)).not.toThrow();
  });

  it("requires homepage full-admin access before upserting banner messages", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "store") {
            return { _id: id, organizationId: "org-1" };
          }
          if (table === "bannerMessage") {
            return { ...bannerDocument, _id: id };
          }
          return null;
        }),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            first: vi.fn(async () => null),
          })),
        })),
        insert: vi.fn(async () => "banner-1"),
        patch: vi.fn(),
      },
      scheduler: {
        runAt: vi.fn(),
      },
    };

    await getHandler(upsert)(ctx, {
      storeId: "store-1",
      heading: "Flash sale",
      message: "Today only",
      active: true,
      currentTimeMs: 1_000,
    });

    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to manage homepage content.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
  });

  it("authorizes banner removal through the existing row store", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "bannerMessage") {
            return { _id: id, storeId: "store-1" };
          }
          if (table === "store") {
            return { _id: id, organizationId: "org-1" };
          }
          return null;
        }),
        delete: vi.fn(),
      },
    };

    await expect(getHandler(remove)(ctx, { id: "banner-1" })).resolves.toBe(
      true,
    );

    expect(ctx.db.delete).toHaveBeenCalledWith("bannerMessage", "banner-1");
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to manage homepage content.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
  });
});

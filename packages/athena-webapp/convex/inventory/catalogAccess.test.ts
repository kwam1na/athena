/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { operationAdmissionDenialData } from "../operationAdmission/adapters";
import schema from "../schema";
import {
  CATALOG_ACCESS_TOKEN_LABEL_MAX_LENGTH,
  CATALOG_ACCESS_TOKEN_PATTERN,
  CATALOG_ACCESS_TOKEN_TOUCH_INTERVAL_MS,
  MAX_ACTIVE_CATALOG_ACCESS_TOKENS,
  hashCatalogAccessTokenValue,
  list,
  mint,
  normalizeCatalogAccessTokenLabel,
  revoke,
  touch,
} from "./catalogAccess";
import { removeStoreWithCtx } from "./stores";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./inventory/"),
    loader,
  ]),
);

const ACCESS_DENIED = "Catalogue access unavailable.";

type AnyHandler = (ctx: unknown, args: unknown) => Promise<unknown>;

function getHandler(fn: unknown): AnyHandler {
  return (fn as { _handler: AnyHandler })._handler;
}

// The admission rail resolves identity from the admitted actor, so injecting
// one stands in for a signed-in session while every database-backed check
// (membership, the row's own store) stays real.
function asAdmitted(ctx: MutationCtx, athenaUserId: Id<"athenaUser">) {
  return {
    ...ctx,
    operationAdmission: {
      actor: { kind: "normal_user" as const, athenaUserId },
    },
  };
}

type Fixture = {
  adminA: Id<"athenaUser">;
  adminB: Id<"athenaUser">;
  storeA: Id<"store">;
  storeB: Id<"store">;
};

async function seedFixture(ctx: MutationCtx): Promise<Fixture> {
  async function seedUser(email: string) {
    return ctx.db.insert("athenaUser", { email, normalizedEmail: email });
  }
  const adminA = await seedUser("admin-a@example.com");
  const adminB = await seedUser("admin-b@example.com");

  const organizationA = await ctx.db.insert("organization", {
    createdByUserId: adminA,
    name: "Org A",
    slug: "org-a",
  });
  const organizationB = await ctx.db.insert("organization", {
    createdByUserId: adminB,
    name: "Org B",
    slug: "org-b",
  });
  const storeA = await ctx.db.insert("store", {
    createdByUserId: adminA,
    currency: "GHS",
    name: "Org A Store",
    organizationId: organizationA,
    slug: "org-a-store",
  });
  const storeB = await ctx.db.insert("store", {
    createdByUserId: adminB,
    currency: "GHS",
    name: "Org B Store",
    organizationId: organizationB,
    slug: "org-b-store",
  });

  await ctx.db.insert("organizationMember", {
    organizationId: organizationA,
    userId: adminA,
    role: "full_admin",
  });
  await ctx.db.insert("organizationMember", {
    organizationId: organizationB,
    userId: adminB,
    role: "full_admin",
  });

  return { adminA, adminB, storeA, storeB };
}

function callMint(
  t: ReturnType<typeof convexTest>,
  userId: Id<"athenaUser">,
  args: { storeId: Id<"store">; label: string },
) {
  return t.run((ctx) =>
    getHandler(mint)(asAdmitted(ctx, userId), args),
  ) as Promise<
    | { kind: "ok"; data: { tokenId: Id<"catalogAccessToken">; token: string } }
    | { kind: "user_error"; error: { code: string; message: string } }
  >;
}

function callRevoke(
  t: ReturnType<typeof convexTest>,
  userId: Id<"athenaUser">,
  args: { storeId: Id<"store">; tokenId: Id<"catalogAccessToken"> },
) {
  return t.run((ctx) => getHandler(revoke)(asAdmitted(ctx, userId), args));
}

function callList(
  t: ReturnType<typeof convexTest>,
  userId: Id<"athenaUser">,
  args: { storeId: Id<"store"> },
) {
  return t.run((ctx) => getHandler(list)(asAdmitted(ctx, userId), args)) as
    Promise<
      Array<{
        tokenId: Id<"catalogAccessToken">;
        label: string;
        status: "active" | "revoked";
        createdAt: number;
        lastUsedAt?: number;
        revokedAt?: number;
      }>
    >;
}

function callTouch(
  t: ReturnType<typeof convexTest>,
  tokenId: Id<"catalogAccessToken">,
) {
  return t.run((ctx) => getHandler(touch)(ctx, { tokenId }));
}

async function expectOk(
  result: Awaited<ReturnType<typeof callMint>>,
): Promise<{ tokenId: Id<"catalogAccessToken">; token: string }> {
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected ok");
  return result.data;
}

describe("catalogue access token value", () => {
  it("is 32 CSPRNG bytes of base64url behind the athcat_ prefix", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const minted = await expectOk(
      await callMint(t, fixture.adminA, {
        storeId: fixture.storeA,
        label: "Hey Lobby",
      }),
    );

    expect(minted.token).toMatch(CATALOG_ACCESS_TOKEN_PATTERN);
    expect(minted.token).toHaveLength("athcat_".length + 43);
  });

  it("stores the lowercase hex SHA-256 crypto.subtle.digest computes", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const minted = await expectOk(
      await callMint(t, fixture.adminA, {
        storeId: fixture.storeA,
        label: "Hey Lobby",
      }),
    );

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(minted.token),
    );
    const expected = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    expect(hashCatalogAccessTokenValue(minted.token)).toBe(expected);
    const row = await t.run((ctx) =>
      ctx.db.get("catalogAccessToken", minted.tokenId),
    );
    expect(row?.tokenHash).toBe(expected);
  });

  it("mints a distinct value every time", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const first = await expectOk(
      await callMint(t, fixture.adminA, {
        storeId: fixture.storeA,
        label: "One",
      }),
    );
    const second = await expectOk(
      await callMint(t, fixture.adminA, {
        storeId: fixture.storeA,
        label: "Two",
      }),
    );

    expect(first.token).not.toBe(second.token);
  });
});

describe("mint / list / revoke", () => {
  it("lists a minted token and never returns its hash", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const minted = await expectOk(
      await callMint(t, fixture.adminA, {
        storeId: fixture.storeA,
        label: "Hey Lobby",
      }),
    );

    const rows = await callList(t, fixture.adminA, { storeId: fixture.storeA });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tokenId: minted.tokenId,
      label: "Hey Lobby",
      status: "active",
    });
    expect(rows[0].lastUsedAt).toBeUndefined();
    expect(Object.keys(rows[0])).not.toContain("tokenHash");
    assertConformsToExportedReturns(list, rows);

    const revoked = await callRevoke(t, fixture.adminA, {
      storeId: fixture.storeA,
      tokenId: minted.tokenId,
    });
    expect(revoked).toEqual({ kind: "ok", data: null });
    assertConformsToExportedReturns(revoke, revoked);

    const afterRevoke = await callList(t, fixture.adminA, {
      storeId: fixture.storeA,
    });
    expect(afterRevoke).toHaveLength(1);
    expect(afterRevoke[0].status).toBe("revoked");
    expect(afterRevoke[0].revokedAt).toEqual(expect.any(Number));
  });

  it("records the minting admin and returns the raw value only once", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const minted = await expectOk(
      await callMint(t, fixture.adminA, {
        storeId: fixture.storeA,
        label: "Hey Lobby",
      }),
    );
    assertConformsToExportedReturns(mint, { kind: "ok", data: minted });

    const row = await t.run((ctx) =>
      ctx.db.get("catalogAccessToken", minted.tokenId),
    );
    expect(row?.createdByUserId).toBe(fixture.adminA);
    expect(row?.tokenHash).not.toContain(minted.token);

    const rows = await callList(t, fixture.adminA, { storeId: fixture.storeA });
    expect(JSON.stringify(rows)).not.toContain(minted.token);
  });

  it("refuses the sixth active token and allows a mint after a revoke", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const minted = [];
    for (let index = 0; index < MAX_ACTIVE_CATALOG_ACCESS_TOKENS; index += 1) {
      minted.push(
        await expectOk(
          await callMint(t, fixture.adminA, {
            storeId: fixture.storeA,
            label: `Token ${index}`,
          }),
        ),
      );
    }

    const refused = await callMint(t, fixture.adminA, {
      storeId: fixture.storeA,
      label: "One too many",
    });
    expect(refused.kind).toBe("user_error");
    if (refused.kind !== "user_error") throw new Error("expected refusal");
    expect(refused.error.code).toBe("precondition_failed");
    assertConformsToExportedReturns(mint, refused);
    expect(
      await callList(t, fixture.adminA, { storeId: fixture.storeA }),
    ).toHaveLength(MAX_ACTIVE_CATALOG_ACCESS_TOKENS);

    await callRevoke(t, fixture.adminA, {
      storeId: fixture.storeA,
      tokenId: minted[0].tokenId,
    });
    const afterRevoke = await callMint(t, fixture.adminA, {
      storeId: fixture.storeA,
      label: "Replacement",
    });
    expect(afterRevoke.kind).toBe("ok");
  });

  it("bounds the label and strips control characters", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    expect(normalizeCatalogAccessTokenLabel("Hey\u0000 Lo\nbby ")).toBe(
      "Hey Lobby",
    );

    const minted = await expectOk(
      await callMint(t, fixture.adminA, {
        storeId: fixture.storeA,
        label: "Hey\u0000 Lo\nbby ",
      }),
    );
    const row = await t.run((ctx) =>
      ctx.db.get("catalogAccessToken", minted.tokenId),
    );
    expect(row?.label).toBe("Hey Lobby");

    const blank = await callMint(t, fixture.adminA, {
      storeId: fixture.storeA,
      label: "\u0001\u0002  ",
    });
    expect(blank.kind).toBe("user_error");

    const tooLong = await callMint(t, fixture.adminA, {
      storeId: fixture.storeA,
      label: "x".repeat(CATALOG_ACCESS_TOKEN_LABEL_MAX_LENGTH + 1),
    });
    expect(tooLong.kind).toBe("user_error");

    const atLimit = await callMint(t, fixture.adminA, {
      storeId: fixture.storeA,
      label: "x".repeat(CATALOG_ACCESS_TOKEN_LABEL_MAX_LENGTH),
    });
    expect(atLimit.kind).toBe("ok");
  });
});

describe("cross-organization access", () => {
  it("refuses another organization's full admin on revoke and leaves the token active", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const minted = await expectOk(
      await callMint(t, fixture.adminA, {
        storeId: fixture.storeA,
        label: "Hey Lobby",
      }),
    );

    // Admitted on their OWN store, reaching for another store's row.
    const error = await callRevoke(t, fixture.adminB, {
      storeId: fixture.storeB,
      tokenId: minted.tokenId,
    }).catch((caught: unknown) => caught);

    expect(operationAdmissionDenialData(error)?.reason).toBe("scope_denied");

    const row = await t.run((ctx) =>
      ctx.db.get("catalogAccessToken", minted.tokenId),
    );
    expect(row?.status).toBe("active");
    expect(row?.revokedAt).toBeUndefined();
  });

  it("refuses another organization's full admin on the listing", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await callMint(t, fixture.adminA, {
      storeId: fixture.storeA,
      label: "Hey Lobby",
    });

    await expect(
      callList(t, fixture.adminB, { storeId: fixture.storeA }),
    ).rejects.toThrow(ACCESS_DENIED);
  });

  it("refuses another organization's full admin on mint", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await expect(
      callMint(t, fixture.adminB, {
        storeId: fixture.storeA,
        label: "Hey Lobby",
      }),
    ).rejects.toThrow(ACCESS_DENIED);
  });
});

describe("touch", () => {
  it("stamps an active token once per interval and never a revoked one", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const minted = await expectOk(
      await callMint(t, fixture.adminA, {
        storeId: fixture.storeA,
        label: "Hey Lobby",
      }),
    );

    await callTouch(t, minted.tokenId);
    const firstStamp = await t.run(
      async (ctx) =>
        (await ctx.db.get("catalogAccessToken", minted.tokenId))?.lastUsedAt,
    );
    expect(firstStamp).toEqual(expect.any(Number));

    // Inside the interval nothing is written.
    await callTouch(t, minted.tokenId);
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.get("catalogAccessToken", minted.tokenId))?.lastUsedAt,
      ),
    ).toBe(firstStamp);

    // Beyond the interval it is.
    const stale = (firstStamp as number) - CATALOG_ACCESS_TOKEN_TOUCH_INTERVAL_MS - 1;
    await t.run((ctx) =>
      ctx.db.patch("catalogAccessToken", minted.tokenId, { lastUsedAt: stale }),
    );
    await callTouch(t, minted.tokenId);
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.get("catalogAccessToken", minted.tokenId))?.lastUsedAt,
      ),
    ).not.toBe(stale);

    await callRevoke(t, fixture.adminA, {
      storeId: fixture.storeA,
      tokenId: minted.tokenId,
    });
    const beforeRevokedTouch = await t.run(
      async (ctx) =>
        (await ctx.db.get("catalogAccessToken", minted.tokenId))?.lastUsedAt,
    );
    await t.run((ctx) =>
      ctx.db.patch("catalogAccessToken", minted.tokenId, {
        lastUsedAt: (beforeRevokedTouch as number) - 10 * CATALOG_ACCESS_TOKEN_TOUCH_INTERVAL_MS,
      }),
    );
    const stampedBefore = await t.run(
      async (ctx) =>
        (await ctx.db.get("catalogAccessToken", minted.tokenId))?.lastUsedAt,
    );
    await callTouch(t, minted.tokenId);
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.get("catalogAccessToken", minted.tokenId))?.lastUsedAt,
      ),
    ).toBe(stampedBefore);
  });
});

describe("store removal", () => {
  it("leaves the store with no tokens", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    await callMint(t, fixture.adminA, {
      storeId: fixture.storeA,
      label: "Hey Lobby",
    });
    await callMint(t, fixture.adminA, {
      storeId: fixture.storeA,
      label: "Second",
    });
    const survivor = await expectOk(
      await callMint(t, fixture.adminB, {
        storeId: fixture.storeB,
        label: "Other store",
      }),
    );

    await t.run((ctx) => removeStoreWithCtx(ctx, fixture.storeA));

    const remaining = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture holds three rows
      ctx.db.query("catalogAccessToken").collect(),
    );
    expect(remaining.map((row) => row._id)).toEqual([survivor.tokenId]);
  });
});

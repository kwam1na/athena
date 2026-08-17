import { describe, expect, it, vi } from "vitest";

import { resolveHomepageSnapshotBootstrap } from "./homepageSnapshot";

describe("homepage snapshot route bootstrap", () => {
  it("returns the public snapshot and store context cookies for a valid store", async () => {
    const snapshot = { contractVersion: "homepage_snapshot.v1" };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "store-1",
        organizationId: "org-1",
      })
      .mockResolvedValueOnce(snapshot);
    const result = await resolveHomepageSnapshotBootstrap({
      runQuery: runQuery as any,
      storeName: "main",
      nowMs: 1_000,
    });

    expect(result).toEqual({
      status: 200,
      body: snapshot,
      cookies: [
        { name: "organization_id", value: "org-1" },
        { name: "store_id", value: "store-1" },
      ],
    });
    expect(runQuery).toHaveBeenLastCalledWith(expect.anything(), {
      storeId: "store-1",
      nowMs: 0,
    });
  });

  it("keeps banner expiry request-time exact while merchandising uses a minute bucket", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "store-1",
        organizationId: "org-1",
      })
      .mockResolvedValueOnce({
        contractVersion: "homepage_snapshot.v1",
        generatedAtMs: 60_000,
        bannerMessage: {
          heading: "Ends now",
          message: null,
          countdownEndsAt: 60_500,
        },
      });

    const result = await resolveHomepageSnapshotBootstrap({
      runQuery: runQuery as any,
      storeName: "main",
      nowMs: 60_500,
    });

    expect(runQuery).toHaveBeenLastCalledWith(expect.anything(), {
      storeId: "store-1",
      nowMs: 60_000,
    });
    expect(result.body).toMatchObject({
      generatedAtMs: 60_500,
      bannerMessage: null,
    });
  });

  it("never mints a guest session, whatever bootstrap parameters a caller sends", async () => {
    // Guest cookies are minted, SIGNED, at `GET /storefront` and `GET /guests`
    // only. This route used to be a third mint point that set a bare unsigned
    // `guest_id`; it now ignores `asNewUser` / `marker` entirely and issues
    // just the store context.
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "store-1",
        organizationId: "org-1",
      })
      .mockResolvedValueOnce({ contractVersion: "homepage_snapshot.v1" });

    const result = await resolveHomepageSnapshotBootstrap({
      runQuery: runQuery as any,
      storeName: "main",
      nowMs: 1_000,
      // Extra query parameters a caller might still send are not part of the
      // contract and cannot reach a guest lookup or a guest mint.
      ...({ marker: "marker-1", asNewUser: "true" } as object),
    });

    expect(result.cookies.map((cookie) => cookie.name)).toEqual([
      "organization_id",
      "store_id",
    ]);
    // Only the store lookup and the snapshot read: no guest query, no mint.
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("uses the existing public error shape when store context cannot resolve", async () => {
    const result = await resolveHomepageSnapshotBootstrap({
      runQuery: vi.fn() as any,
      nowMs: 1_000,
    });

    expect(result).toEqual({
      status: 404,
      body: { error: "Store name missing" },
      cookies: [],
    });
  });
});

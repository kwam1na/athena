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
    const runMutation = vi.fn();

    const result = await resolveHomepageSnapshotBootstrap({
      runQuery: runQuery as any,
      runMutation: runMutation as any,
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
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("creates a guest only for explicit new-user requests with a marker", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "store-1",
        organizationId: "org-1",
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ contractVersion: "homepage_snapshot.v1" });
    const runMutation = vi.fn().mockResolvedValueOnce({ _id: "guest-1" });

    const result = await resolveHomepageSnapshotBootstrap({
      runQuery: runQuery as any,
      runMutation: runMutation as any,
      storeName: "main",
      marker: "marker-1",
      asNewUser: "true",
      nowMs: 1_000,
    });

    expect(result.cookies).toContainEqual({
      name: "guest_id",
      value: "guest-1",
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("does not create guest cookies for tampered new-user parameters", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "store-1",
        organizationId: "org-1",
      })
      .mockResolvedValueOnce({ contractVersion: "homepage_snapshot.v1" });
    const runMutation = vi.fn();

    const result = await resolveHomepageSnapshotBootstrap({
      runQuery: runQuery as any,
      runMutation: runMutation as any,
      storeName: "main",
      marker: " ",
      asNewUser: "true",
      nowMs: 1_000,
    });

    expect(result.cookies.map((cookie) => cookie.name)).toEqual([
      "organization_id",
      "store_id",
    ]);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("uses the existing public error shape when store context cannot resolve", async () => {
    const result = await resolveHomepageSnapshotBootstrap({
      runQuery: vi.fn() as any,
      runMutation: vi.fn() as any,
      nowMs: 1_000,
    });

    expect(result).toEqual({
      status: 404,
      body: { error: "Store name missing" },
      cookies: [],
    });
  });
});

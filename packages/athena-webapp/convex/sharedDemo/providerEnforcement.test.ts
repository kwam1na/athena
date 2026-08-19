import { describe, expect, it, vi } from "vitest";
import * as stream from "../cloudflare/stream";

const invoke = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as any)._handler(ctx, args);

/**
 * The Cloudflare Stream actions used to open with
 * `ctx.runQuery(requireAuthenticatedNonDemoEffectRef)`, and this suite proved
 * the denial landed before any credential read, `fetch`, or internal write.
 *
 * The guard is now the admission rail. An action reaches it through the
 * registered internal admission MUTATION, so the seam this suite drives moved
 * from `ctx.runQuery` to `ctx.runMutation` — the assertion is unchanged and is
 * the thing that matters: a denied demo caller never reaches the provider.
 */
describe("public provider action enforcement", () => {
  it.each([
    [stream.getDirectUploadUrl, {}],
    [stream.getVideoStatus, { streamUid: "video" }],
    [stream.deleteVideo, { streamUid: "video" }],
    [stream.addStreamReelVersion, { storeId: "demo-store", streamUid: "video", hlsUrl: "x" }],
    [stream.deleteStreamReelVersion, { storeId: "demo-store", version: 1 }],
    [stream.setActiveStreamReel, { storeId: "demo-store", version: 1 }],
  ] as const)("denies before credentials, fetch, or internal effects", async (fn, args) => {
    const denial = new Error("This action is unavailable in the demo.");
    const runMutation = vi.fn().mockRejectedValue(denial);
    const ctx = { runMutation, runQuery: vi.fn() };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(invoke(fn, ctx, args)).rejects.toThrow(denial.message);

    // Exactly one call: the admission hop that denied. Nothing downstream ran.
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

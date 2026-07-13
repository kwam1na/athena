import { describe, expect, it, vi } from "vitest";
import * as stream from "../cloudflare/stream";

const invoke = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as any)._handler(ctx, args);

describe("public provider action enforcement", () => {
  it.each([
    [stream.getDirectUploadUrl, {}],
    [stream.getVideoStatus, { streamUid: "video" }],
    [stream.deleteVideo, { streamUid: "video" }],
    [stream.addStreamReelVersion, { storeId: "demo-store", streamUid: "video", hlsUrl: "x" }],
    [stream.deleteStreamReelVersion, { storeId: "demo-store", version: 1 }],
    [stream.setActiveStreamReel, { storeId: "demo-store", version: 1 }],
  ] as const)("denies before credentials, fetch, or internal effects", async (fn, args) => {
    const denial = new Error("This action is unavailable in the shared demo.");
    const ctx = { runQuery: vi.fn().mockRejectedValue(denial), runMutation: vi.fn() };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(invoke(fn, ctx, args)).rejects.toThrow(denial.message);
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

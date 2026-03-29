import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";
import { normalizeStoreConfig } from "../inventory/storeConfigV2";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function getCloudflareConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_KEY;

  if (!accountId || !apiToken) {
    throw new Error(
      "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_KEY environment variables",
    );
  }

  return { accountId, apiToken };
}

/**
 * Request a direct upload URL from Cloudflare Stream.
 * The frontend uploads directly to this URL — no need to proxy
 * the video through Convex.
 */
export const getDirectUploadUrl = action({
  args: {
    maxDurationSeconds: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const { accountId, apiToken } = getCloudflareConfig();
    const maxDuration = args.maxDurationSeconds || 300; // 5 min default

    const response = await fetch(
      `${CLOUDFLARE_API_BASE}/accounts/${accountId}/stream/direct_upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maxDurationSeconds: maxDuration,
          requireSignedURLs: false,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get upload URL: ${error}`);
    }

    const data = await response.json();

    return {
      uploadUrl: data.result.uploadURL as string,
      streamUid: data.result.uid as string,
    };
  },
});

/**
 * Check the processing status of an uploaded video.
 * Returns the status and HLS playback URL when ready.
 */
export const getVideoStatus = action({
  args: {
    streamUid: v.string(),
  },
  handler: async (_ctx, args) => {
    const { accountId, apiToken } = getCloudflareConfig();

    const response = await fetch(
      `${CLOUDFLARE_API_BASE}/accounts/${accountId}/stream/${args.streamUid}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get video status: ${error}`);
    }

    const data = await response.json();
    const video = data.result;

    return {
      uid: video.uid as string,
      status: video.status as { state: string; pctComplete?: string },
      readyToStream: video.readyToStream as boolean,
      playback: video.playback as { hls: string; dash: string } | undefined,
      duration: video.duration as number | undefined,
      thumbnail: video.thumbnail as string | undefined,
    };
  },
});

/**
 * Delete a video from Cloudflare Stream.
 */
export const deleteVideo = action({
  args: {
    streamUid: v.string(),
  },
  handler: async (_ctx, args) => {
    const { accountId, apiToken } = getCloudflareConfig();

    const response = await fetch(
      `${CLOUDFLARE_API_BASE}/accounts/${accountId}/stream/${args.streamUid}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete video: ${error}`);
    }

    return { success: true };
  },
});

/**
 * Add a new reel version from a Cloudflare Stream upload.
 * Called after the video is ready to stream.
 */
export const addStreamReelVersion = action({
  args: {
    storeId: v.id("store"),
    streamUid: v.string(),
    hlsUrl: v.string(),
    thumbnailUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: true; version: number }> => {
    const store: any = await ctx.runQuery(api.inventory.stores.getById, {
      id: args.storeId,
    });

    if (!store) {
      throw new Error("Store not found");
    }

    const normalizedConfig = normalizeStoreConfig(store.config);
    const existingReels: any[] = normalizedConfig.media.reels.streamReels || [];

    // Auto-increment version
    const maxVersion: number = existingReels.reduce(
      (max: number, reel: { version: number }) => Math.max(max, reel.version),
      0,
    );
    const newVersion: number = maxVersion + 1;

    const newReel = {
      version: newVersion,
      source: "stream" as const,
      streamUid: args.streamUid,
      hlsUrl: args.hlsUrl,
      thumbnailUrl: args.thumbnailUrl,
      createdAt: Date.now(),
    };

    await ctx.runMutation(api.inventory.stores.patchConfigV2, {
      id: args.storeId,
      patch: {
        media: {
          reels: {
            streamReels: [...existingReels, newReel],
          },
        },
      },
    });

    return { success: true, version: newVersion };
  },
});

/**
 * Delete a reel version and its associated Cloudflare Stream video.
 */
export const deleteStreamReelVersion = action({
  args: {
    storeId: v.id("store"),
    version: v.number(),
  },
  handler: async (ctx, args): Promise<{ success: true }> => {
    const store: any = await ctx.runQuery(api.inventory.stores.getById, {
      id: args.storeId,
    });

    if (!store) {
      throw new Error("Store not found");
    }

    const normalizedConfig = normalizeStoreConfig(store.config);
    const existingReels: any[] = normalizedConfig.media.reels.streamReels || [];
    const reelToDelete = existingReels.find(
      (r: { version: number }) => r.version === args.version,
    );

    if (!reelToDelete) {
      throw new Error("Reel version not found");
    }

    // Delete from Cloudflare Stream
    if (reelToDelete.streamUid) {
      const { accountId, apiToken } = getCloudflareConfig();
      await fetch(
        `${CLOUDFLARE_API_BASE}/accounts/${accountId}/stream/${reelToDelete.streamUid}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        },
      );
    }

    // Remove from store config
    const updatedReels = existingReels.filter(
      (r: { version: number }) => r.version !== args.version,
    );

    // If the deleted version was active, clear it
    const patch: Record<string, any> = {
      media: {
        reels: {
          streamReels: updatedReels,
        },
      },
    };
    if (normalizedConfig.media.reels.activeVersion === args.version) {
      patch.media.reels.activeVersion = null;
      patch.media.reels.activeHlsUrl = null;
    }

    await ctx.runMutation(api.inventory.stores.patchConfigV2, {
      id: args.storeId,
      patch,
    });

    return { success: true };
  },
});

/**
 * Set the active reel version for the storefront.
 */
export const setActiveStreamReel = action({
  args: {
    storeId: v.id("store"),
    version: v.number(),
    hlsUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: true }> => {
    const store: any = await ctx.runQuery(api.inventory.stores.getById, {
      id: args.storeId,
    });

    if (!store) {
      throw new Error("Store not found");
    }

    const normalizedConfig = normalizeStoreConfig(store.config);
    const existingReels: any[] = normalizedConfig.media.reels.streamReels || [];
    const reel = existingReels.find(
      (r: { version: number }) => r.version === args.version,
    );

    if (!reel) {
      throw new Error("Reel version not found");
    }

    await ctx.runMutation(api.inventory.stores.patchConfigV2, {
      id: args.storeId,
      patch: {
        media: {
          reels: {
            activeVersion: args.version,
            activeHlsUrl: args.hlsUrl,
          },
        },
      },
    });

    return { success: true };
  },
});

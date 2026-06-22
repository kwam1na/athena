import { describe, expect, it, vi } from "vitest";

import { api } from "../../../../_generated/api";
import { resolvePublicBannerMessage } from "./bannerMessage";

describe("public banner message route", () => {
  it("reads only currently public banner content", async () => {
    const publicBanner = { heading: "Flash sale" };
    const runQuery = vi.fn().mockResolvedValue(publicBanner);

    const result = await resolvePublicBannerMessage({
      runQuery: runQuery as any,
      storeId: "store-1",
      nowMs: 1_000,
    });

    expect(result).toEqual({
      status: 200,
      body: { bannerMessage: publicBanner },
    });
    expect(runQuery).toHaveBeenCalledWith(
      api.inventory.bannerMessage.getPublicActive,
      {
        storeId: "store-1",
        nowMs: 1_000,
      },
    );
  });

  it("keeps the existing error shape when store context is missing", async () => {
    const result = await resolvePublicBannerMessage({
      runQuery: vi.fn() as any,
      nowMs: 1_000,
    });

    expect(result).toEqual({
      status: 400,
      body: { error: "Missing data to retrieve banner message" },
    });
  });
});

import { describe, expect, it } from "vitest";

import type { ProductVariant } from "../ProductStock";
import { buildCopyImagesSkuUpdate } from "./CopyImagesView";

describe("buildCopyImagesSkuUpdate", () => {
  it("submits only the destination id and replacement images", () => {
    const source = {
      id: "source-sku",
      images: [{ preview: "source.webp" }],
    } as ProductVariant;
    const destination = {
      id: "destination-sku",
      stock: 8,
      quantityAvailable: 6,
      cost: 0,
      images: [{ preview: "destination.webp" }],
    } as ProductVariant;

    expect(buildCopyImagesSkuUpdate(source, destination)).toEqual({
      id: "destination-sku",
      update: {
        images: ["source.webp"],
      },
    });
  });
});

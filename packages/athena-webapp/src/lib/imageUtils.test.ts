import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config", () => ({
  default: {
    s3: {
      BUCKET: "athena-bucket",
    },
  },
}));

const { deleteFileInS3, uploadFileToS3 } = vi.hoisted(() => ({
  deleteFileInS3: vi.fn(),
  uploadFileToS3: vi.fn(),
}));

vi.mock("./aws", () => ({
  deleteFileInS3,
  uploadFileToS3,
}));

import {
  deleteFile,
  deleteFiles,
  uploadFile,
  uploadProductImages,
} from "./imageUtils";

describe("imageUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads a single file to the configured bucket", async () => {
    uploadFileToS3.mockResolvedValue({
      success: true,
      key: "products/1/hero.png",
      url: "https://cdn.example.com/products/1/hero.png",
    });

    const file = {
      preview: "blob:hero",
      file: { path: "hero.png" },
    };

    const result = await uploadFile(file as never, "products/1");

    expect(uploadFileToS3).toHaveBeenCalledWith(
      file.file,
      "athena-bucket",
      "products/1/hero.png"
    );
    expect(result).toEqual({
      success: true,
      key: "products/1/hero.png",
      url: "https://cdn.example.com/products/1/hero.png",
    });
  });

  it("groups delete results into success and failure buckets", async () => {
    deleteFileInS3
      .mockResolvedValueOnce({
        success: true,
        key: "products/1/old-a.png",
      })
      .mockResolvedValueOnce({
        success: false,
        key: "products/1/old-b.png",
        url: "https://cdn.example.com/products/1/old-b.png",
      });

    const result = await deleteFiles([
      "https://cdn.example.com/products/1/old-a.png",
      "https://cdn.example.com/products/1/old-b.png",
    ]);

    expect(deleteFileInS3).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      successfulDeletedKeys: ["products/1/old-a.png"],
      failedDeleteKeys: ["products/1/old-b.png"],
      failedDeleteUrls: ["https://cdn.example.com/products/1/old-b.png"],
    });
  });

  it("uploads new images, preserves existing urls, and reports failures", async () => {
    deleteFileInS3.mockResolvedValue({
      success: false,
      key: "products/1/remove-me.png",
      url: "https://cdn.example.com/products/1/remove-me.png",
    });

    uploadFileToS3
      .mockResolvedValueOnce({
        success: true,
        key: "products/1/new-a.png",
        url: "https://cdn.example.com/products/1/new-a.png",
      })
      .mockResolvedValueOnce({
        success: false,
        key: "products/1/new-b.png",
        url: "local-preview://new-b.png",
      });

    const result = await uploadProductImages(
      [
        {
          preview: "https://cdn.example.com/products/1/keep-me.png",
        },
        {
          preview: "https://cdn.example.com/products/1/remove-me.png",
          markedForDeletion: true,
        },
        {
          preview: "blob:new-a",
          file: { path: "new-a.png" },
        },
        {
          preview: "blob:new-b",
          file: { path: "new-b.png" },
        },
      ] as never,
      "products/1"
    );

    expect(deleteFileInS3).toHaveBeenCalledWith(
      "athena-bucket",
      "https://cdn.example.com/products/1/remove-me.png"
    );
    expect(uploadFileToS3).toHaveBeenNthCalledWith(
      1,
      { path: "new-a.png" },
      "athena-bucket",
      "products/1/new-a.png"
    );
    expect(uploadFileToS3).toHaveBeenNthCalledWith(
      2,
      { path: "new-b.png" },
      "athena-bucket",
      "products/1/new-b.png"
    );
    expect(result).toEqual({
      imageUrls: [
        "https://cdn.example.com/products/1/keep-me.png",
        "https://cdn.example.com/products/1/new-a.png",
      ],
      successfulUploadUrls: [
        "https://cdn.example.com/products/1/new-a.png",
      ],
      successfulDeletedKeys: [],
      failedUploadKeys: ["products/1/new-b.png"],
      failedDeleteKeys: ["products/1/remove-me.png"],
      failedDeleteUrls: ["https://cdn.example.com/products/1/remove-me.png"],
      failedUploadUrls: ["local-preview://new-b.png"],
    });
  });

  it("passes through deleteFile calls to the aws helper", async () => {
    deleteFileInS3.mockResolvedValue({
      success: true,
      key: "products/1/hero.png",
    });

    await deleteFile("https://cdn.example.com/products/1/hero.png");

    expect(deleteFileInS3).toHaveBeenCalledWith(
      "athena-bucket",
      "https://cdn.example.com/products/1/hero.png"
    );
  });
});

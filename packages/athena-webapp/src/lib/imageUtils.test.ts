import { beforeEach, describe, expect, it, vi } from "vitest";

const { arrayBufferToWebP } = vi.hoisted(() => ({
  arrayBufferToWebP: vi.fn(),
}));

vi.mock("webp-converter-browser", () => ({
  arrayBufferToWebP,
}));

import {
  convertImagesToJpg,
  convertImagesToWebp,
  getUploadImagesData,
} from "./imageUtils";

describe("imageUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("splits kept, deleted, and new images", () => {
    const existing = {
      preview: "https://cdn.example.com/keep-me.png",
    };
    const deleted = {
      preview: "https://cdn.example.com/delete-me.png",
      markedForDeletion: true,
    };
    const fresh = {
      preview: "blob:new-image",
      file: { name: "new-image.png" },
    };

    expect(getUploadImagesData([existing, deleted, fresh] as never)).toEqual({
      updatedImageUrls: ["https://cdn.example.com/keep-me.png"],
      imageUrlsToDelete: ["https://cdn.example.com/delete-me.png"],
      newImages: [fresh],
    });
  });

  it("converts image buffers to webp buffers", async () => {
    const sourceBuffer = new Uint8Array([1, 2, 3]).buffer;
    const convertedBuffer = new Uint8Array([9, 8, 7]).buffer;

    arrayBufferToWebP.mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(convertedBuffer),
    });

    const file = {
      arrayBuffer: vi.fn().mockResolvedValue(sourceBuffer),
    };

    const result = await convertImagesToWebp([{ file }] as never);

    expect(arrayBufferToWebP).toHaveBeenCalledWith(sourceBuffer, {
      quality: 0.8,
    });
    expect(result).toEqual([convertedBuffer]);
  });

  it("converts image files to jpg buffers", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalImage = globalThis.Image;
    const originalFile = globalThis.File;
    const originalCreateElement = document.createElement.bind(document);
    const jpgBuffer = new Uint8Array([4, 5, 6]).buffer;

    URL.createObjectURL = vi.fn(() => "blob:preview");

    globalThis.File = class MockFile {
      name: string;

      constructor(_parts: BlobPart[], name: string) {
        this.name = name;
      }

      async arrayBuffer() {
        return jpgBuffer;
      }
    } as never;

    const drawImage = vi.fn();
    const getContext = vi.fn(() => ({ drawImage }));

    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob(["jpg-data"], { type: "image/jpeg" }));
    });

    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext,
          toBlob,
        } as never;
      }

      return originalCreateElement(tagName);
    });

    class MockImage {
      width = 100;
      height = 50;
      onload: null | (() => void) = null;
      onerror: null | ((error?: unknown) => void) = null;

      set src(_value: string) {
        this.onload?.();
      }
    }

    globalThis.Image = MockImage as never;

    const inputFile = { name: "sample.png" };

    const [buffer] = await convertImagesToJpg([{ file: inputFile }] as never);

    expect(URL.createObjectURL).toHaveBeenCalledWith(inputFile);
    expect(getContext).toHaveBeenCalledWith("2d");
    expect(drawImage).toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.8);
    expect(buffer).toBe(jpgBuffer);

    URL.createObjectURL = originalCreateObjectURL;
    globalThis.File = originalFile;
    globalThis.Image = originalImage;
  });
});

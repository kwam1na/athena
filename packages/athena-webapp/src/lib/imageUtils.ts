import { ImageFile } from "@/components/ui/image-uploader";
import { arrayBufferToWebP } from "webp-converter-browser";

export const getUploadImagesData = (newImageFiles: ImageFile[]) => {
  // urls to keep
  const updatedImageUrls = newImageFiles
    .filter(
      (image) => !image.preview.startsWith("blob:") && !image.markedForDeletion
    )
    .map((image) => image.preview);

  const imageUrlsToDelete = newImageFiles
    .filter((image) => image.markedForDeletion)
    .map((image) => image.preview);

  // get new images being added
  const newImages = newImageFiles.filter((image) => !!image.file);

  return {
    updatedImageUrls,
    imageUrlsToDelete,
    newImages,
  };
};

export const convertImagesToWebp = async (images: ImageFile[]) => {
  const buffers = await Promise.all(
    images.map((file) => file.file!.arrayBuffer())
  );

  const webpBuffers = await Promise.all(
    buffers.map((b) => arrayBufferToWebP(b, { quality: 0.8 }))
  );

  return await Promise.all(webpBuffers.map((b) => b.arrayBuffer()));
};

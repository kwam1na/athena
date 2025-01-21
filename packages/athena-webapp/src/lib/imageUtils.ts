import { ImageFile } from "@/components/ui/image-uploader";
import config from "@/config";
import { deleteFileInS3, uploadFileToS3 } from "./aws";
import { arrayBufferToWebP } from "webp-converter-browser";

export const uploadFile = async (file: ImageFile, path: string) => {
  return await uploadFileToS3(
    file.file!,
    config.s3.BUCKET!,
    `${path}/${file.file?.name!}`
  );
};

export const deleteFile = async (filePath: string) => {
  return await deleteFileInS3(config.s3.BUCKET!, filePath);
};

export const deleteFiles = async (paths: string[]) => {
  const successfulDeletedKeys: string[] = [];
  const failedDeleteKeys: string[] = [];
  const failedDeleteUrls: string[] = [];

  const deleteResults = await Promise.all(
    paths.map((filePath) => deleteFile(filePath))
  );

  deleteResults.forEach((result) => {
    if (result.success) {
      successfulDeletedKeys.push(result.key);
    } else {
      failedDeleteKeys.push(result.key);
      result.url && failedDeleteUrls.push(result.url);
    }
  });

  return { successfulDeletedKeys, failedDeleteKeys, failedDeleteUrls };
};

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

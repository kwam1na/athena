import { ImageFile } from "@/components/ui/image-uploader";
import config from "@/config";
import { deleteFileInS3, uploadFileToS3 } from "./aws";

export const uploadFile = async (
  file: ImageFile,
  storeId: number,
  productId: number
) => {
  return await uploadFileToS3(
    file.file!,
    config.s3.BUCKET!,
    `${storeId}/${productId}/${file.file?.path!}`
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

export const uploadProductImages = async (
  newImageFiles: ImageFile[],
  storeId: number,
  productId: number
) => {
  const successfulUploadUrls: string[] = [];
  const failedUploadKeys: string[] = [];
  const failedUploadUrls: string[] = [];

  // urls to keep
  const updatedImageUrls = newImageFiles
    .filter(
      (image) => !image.preview.startsWith("blob:") && !image.markedForDeletion
    )
    .map((image) => image.preview);

  const imageUrlsToDelete = newImageFiles
    .filter((image) => image.markedForDeletion)
    .map((image) => image.preview);

  const { successfulDeletedKeys, failedDeleteKeys, failedDeleteUrls } =
    await deleteFiles(imageUrlsToDelete);

  // get new images being added
  const newImages = newImageFiles.filter((image) => !!image.file);

  const newImageResults = await Promise.all(
    newImages.map((image) => uploadFile(image, storeId, productId))
  );

  newImageResults.forEach((result) => {
    if (result.success && result.url) {
      successfulUploadUrls.push(result.url);
    } else {
      failedUploadKeys.push(result.key);
      result.url && failedUploadUrls.push(result.url);
    }
  });

  const urls = [...updatedImageUrls, ...successfulUploadUrls];

  const result = {
    imageUrls: urls,
    successfulUploadUrls,
    successfulDeletedKeys,
    failedUploadKeys,
    failedDeleteKeys,
    failedDeleteUrls,
    failedUploadUrls,
  };

  return result;
};

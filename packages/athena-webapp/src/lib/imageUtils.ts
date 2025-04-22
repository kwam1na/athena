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

async function convertToJpg(file: File, quality = 0.8): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas context failed"));

      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Conversion failed"));

          const jpgFile = new File(
            [blob],
            file.name.replace(/\.\w+$/, ".jpg"),
            {
              type: "image/jpeg",
            }
          );

          resolve(jpgFile);
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export const convertImagesToJpg = async (images: ImageFile[]) => {
  const jpgBuffers = await Promise.all(
    images.map((img) => convertToJpg(img.file!, 0.8))
  );

  return await Promise.all(jpgBuffers.map((b) => b.arrayBuffer()));
};

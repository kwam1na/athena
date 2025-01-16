import { Upload } from "lucide-react";
import { FileWithPath, useDropzone } from "react-dropzone";

import { AppContextMenu } from "./app-context-menu";
import { ReloadIcon, TrashIcon } from "@radix-ui/react-icons";

export type ImageFile = {
  preview: string;
  file?: FileWithPath;
  markedForDeletion?: boolean;
};

export default function ImageUploader({
  images,
  updateImages,
}: {
  images: ImageFile[];
  updateImages: React.Dispatch<React.SetStateAction<ImageFile[]>>;
}) {
  const onDrop = (acceptedFiles: FileWithPath[]) => {
    const newImages: ImageFile[] = acceptedFiles.map((file) => ({
      preview: URL.createObjectURL(file),
      file: file,
    }));

    updateImages((prevImages) => [...prevImages, ...newImages]);
  };

  const { getRootProps, getInputProps } = useDropzone({ onDrop });

  const removeImage = (index: number) => {
    const selectedImage = images[index];

    if (selectedImage.preview.startsWith("https:")) {
      // update the selected images in images to be marked for deleting
      updateImages((prevImages) =>
        prevImages.map((img, i) =>
          i === index ? { ...img, markedForDeletion: true } : img
        )
      );
    } else {
      updateImages((prevImages) => prevImages.filter((_, i) => i !== index));
    }
  };

  const unmarkForDeletion = (index: number) => {
    updateImages((prevImages) =>
      prevImages.map((img, i) =>
        i === index ? { ...img, markedForDeletion: false } : img
      )
    );
  };

  return (
    <div className="grid gap-2 p-4">
      <div className="grid grid-cols-2 gap-2">
        {images.map((image, index) => (
          <div
            key={index}
            className="relative aspect-square w-full h-full rounded-md overflow-hidden"
          >
            <AppContextMenu
              menuItems={[
                ...(image.markedForDeletion
                  ? [
                      {
                        title: "Restore",
                        icon: <ReloadIcon className="w-4 h-4" />,
                        action: () => unmarkForDeletion(index),
                      },
                    ]
                  : [
                      {
                        title: "Delete",
                        icon: <TrashIcon className="w-4 h-4" />,
                        action: () => removeImage(index),
                      },
                    ]),
              ]}
            >
              <img
                alt="Uploaded image"
                className={`aspect-square w-full rounded-md object-cover transition-opacity duration-300 ${image.markedForDeletion ? "opacity-50" : ""}`}
                height="200"
                src={image.preview}
                width="200"
              />
              {image.markedForDeletion && (
                <div className="font-medium text-xs absolute top-0 left-0 m-2 text-white bg-black bg-opacity-50 px-2 py-1 rounded-lg">
                  Marked for deletion
                </div>
              )}
            </AppContextMenu>
          </div>
        ))}
        <div
          {...getRootProps()}
          className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed"
        >
          <input {...getInputProps()} />
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="sr-only">Upload</span>
        </div>
      </div>
    </div>
  );
}

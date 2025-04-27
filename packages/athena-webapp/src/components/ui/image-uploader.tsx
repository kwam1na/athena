import { Upload } from "lucide-react";
import { FileWithPath, useDropzone } from "react-dropzone-esm";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";

import { AppContextMenu } from "./app-context-menu";
import { ReloadIcon, TrashIcon } from "@radix-ui/react-icons";
import { useEffect, useRef } from "react";

export type ImageFile = {
  preview: string;
  file?: FileWithPath;
  markedForDeletion?: boolean;
};

export default function ImageUploader({
  images,
  updateImages,
  variantMarkedForDeletion,
}: {
  images: ImageFile[];
  updateImages: (newImages: ImageFile[]) => void;
  variantMarkedForDeletion?: boolean;
}) {
  const previousMarkedForDeletion = useRef(variantMarkedForDeletion);

  const onDrop = (acceptedFiles: FileWithPath[]) => {
    if (variantMarkedForDeletion) return;

    const newImages: ImageFile[] = acceptedFiles.map((file) => ({
      preview: URL.createObjectURL(file),
      file: file,
    }));

    updateImages([...images, ...newImages]);
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    disabled: variantMarkedForDeletion,
  });

  const removeImage = (index: number) => {
    if (variantMarkedForDeletion) return;

    const selectedImage = images[index];

    if (selectedImage.preview.startsWith("https:")) {
      // update the selected images in images to be marked for deleting
      updateImages(
        images.map((img, i) =>
          i === index ? { ...img, markedForDeletion: true } : img
        )
      );
    } else {
      updateImages(images.filter((_, i) => i !== index));
    }
  };

  const unmarkForDeletion = (index: number) => {
    if (variantMarkedForDeletion) return;

    updateImages(
      images.map((img, i) =>
        i === index ? { ...img, markedForDeletion: false } : img
      )
    );
  };

  useEffect(() => {
    if (variantMarkedForDeletion !== previousMarkedForDeletion.current) {
      if (variantMarkedForDeletion) {
        // Mark all images for deletion only if the variant is newly marked for deletion
        updateImages(
          images.map((img) => ({ ...img, markedForDeletion: true }))
        );
      } else {
        // Unmark images only if they were previously marked due to variant deletion

        if (variantMarkedForDeletion == undefined) return;

        updateImages(
          images.map((img) => {
            if (img.markedForDeletion && previousMarkedForDeletion.current) {
              return { ...img, markedForDeletion: false };
            }
            return img;
          })
        );
      }

      previousMarkedForDeletion.current = variantMarkedForDeletion;
    }
  }, [variantMarkedForDeletion, images, updateImages]);

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const reordered = Array.from(images);
    const [removed] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, removed);
    updateImages(reordered);
  };

  return (
    <div className="grid gap-2 p-4">
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="images-list" direction="horizontal">
          {(provided) => (
            <div
              className="grid grid-cols-2 gap-2"
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {images?.map((image, index) => (
                <Draggable
                  key={index}
                  draggableId={String(index)}
                  index={index}
                  isDragDisabled={!!variantMarkedForDeletion}
                >
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={`relative aspect-square w-full h-full rounded-md overflow-hidden ${variantMarkedForDeletion ? "pointer-events-none" : ""}`}
                    >
                      <AppContextMenu
                        menuItems={[
                          ...(image.markedForDeletion
                            ? [
                                {
                                  title: "Restore",
                                  icon: <ReloadIcon className="w-4 h-4" />,
                                  action: () => unmarkForDeletion(index),
                                  disabled: variantMarkedForDeletion,
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
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
              {!variantMarkedForDeletion && (
                <div
                  {...getRootProps()}
                  className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed"
                >
                  <input {...getInputProps()} />
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="sr-only">Upload</span>
                </div>
              )}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}

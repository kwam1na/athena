import React, { useRef, useState, useEffect } from "react";
import { Button } from "../ui/button";
import { LoadingButton } from "../ui/loading-button";
import { Image, PencilIcon, ArrowUp, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "~/src/lib/utils";
import { convertImagesToWebp } from "~/src/lib/imageUtils";
import { ImageFile } from "../ui/image-uploader";
import { useAction, useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";

interface HeroHeaderImageUploaderProps {
  currentImageUrl?: string;
  onImageUpdate?: (newImageUrl: string) => void;
  disabled?: boolean;
  className?: string;
}

export const HeroHeaderImageUploader: React.FC<
  HeroHeaderImageUploaderProps
> = ({ currentImageUrl, onImageUpdate, disabled = false, className }) => {
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Loading states
  const [isUploading, setIsUploading] = useState(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hooks
  const { activeStore } = useGetActiveStore();
  const uploadStoreAssets = useAction(api.inventory.stores.uploadImageAssets);
  const updateConfig = useMutation(api.inventory.stores.updateConfig);

  // Derived state
  const displayImage =
    isEditing && previewImage ? previewImage : currentImageUrl;
  const showEditMode = isEditing && selectedFile;

  // File validation
  const validateFile = (file: File): boolean => {
    // File type validation
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return false;
    }

    // File size validation (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image size must be less than 10MB");
      return false;
    }

    return true;
  };

  // Upload logic
  const uploadImage = async (file: File): Promise<string> => {
    if (!activeStore) {
      throw new Error("No active store found");
    }

    // Convert to ImageFile format for existing utilities
    const imageFile: ImageFile = {
      preview: URL.createObjectURL(file),
      file: file,
    };

    // Use existing image processing pipeline
    const buffer = await convertImagesToWebp([imageFile]);

    // Upload to S3
    const { images } = await uploadStoreAssets({
      images: buffer,
      storeId: activeStore._id,
    });

    if (!images || images.length === 0) {
      throw new Error("Upload failed");
    }

    return images[0];
  };

  // Helper functions
  const resetEditState = () => {
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
    setPreviewImage(null);
    setSelectedFile(null);
    setIsEditing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Event handlers
  const handleEditClick = () => {
    if (disabled || isUploading) return;
    fileInputRef.current?.click();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validation
    if (!validateFile(file)) return;

    // Set preview
    const previewUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewImage(previewUrl);
    setIsEditing(true);
  };

  const handleUpload = async () => {
    if (!selectedFile || !activeStore) return;

    setIsUploading(true);
    try {
      // Upload logic
      const newImageUrl = await uploadImage(selectedFile);

      // Update store config (nest under config.homeHero)
      await updateConfig({
        id: activeStore._id,
        config: {
          ...activeStore.config,
          homeHero: {
            ...activeStore.config?.homeHero,
            headerImage: newImageUrl,
          },
        },
      });

      // Notify parent
      onImageUpdate?.(newImageUrl);

      // Reset state
      resetEditState();

      toast.success("Hero header image updated successfully");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRevert = () => {
    if (isUploading) return;
    resetEditState();
  };

  // Cleanup effect
  useEffect(() => {
    return () => {
      // Cleanup any remaining blob URLs
      if (previewImage) {
        URL.revokeObjectURL(previewImage);
      }
    };
  }, [previewImage]);

  // Sub-components for cleaner code
  const EditModeButtons = () => (
    <div className="flex items-center gap-2">
      <LoadingButton
        isLoading={isUploading}
        onClick={handleUpload}
        disabled={!selectedFile || disabled}
        size="sm"
        variant="outline"
        className="flex items-center gap-2"
      >
        {!isUploading && <ArrowUp className="h-4 w-4" />}
        {isUploading ? "Uploading..." : "Upload"}
      </LoadingButton>
      <Button
        variant="ghost"
        onClick={handleRevert}
        disabled={isUploading}
        size="sm"
        className="flex items-center gap-2"
      >
        <RotateCcw className="h-4 w-4" />
        Revert
      </Button>
    </div>
  );

  const ViewModeButton = () => (
    <Button variant="ghost" onClick={handleEditClick} disabled={disabled}>
      <PencilIcon className="h-4 w-4" />
      <p className="text-xs">Update image</p>
    </Button>
  );

  return (
    <div className={cn("space-y-4", className)}>
      {/* Image Display */}
      <div className="relative">
        {displayImage ? (
          <img
            src={displayImage}
            alt="Hero header"
            className="w-[400px] h-[640px] object-cover rounded-lg"
            style={{ aspectRatio: "16/9" }}
          />
        ) : (
          <div className="w-[400px] h-[640px] bg-muted rounded-lg flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Image className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">No hero image uploaded</p>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        {/* Action Buttons */}
        {showEditMode ? <EditModeButtons /> : <ViewModeButton />}
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled}
      />
    </div>
  );
};

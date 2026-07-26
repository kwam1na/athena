import { useState } from "react";

import { StorefrontImage } from "../ui/storefront-image";
import { cn } from "@/lib/utils";

interface GalleryViewerProps {
  images: string[];
  productName: string;
  fallbackImageUrl?: string;
}

export default function GalleryViewer({
  images,
  productName,
  fallbackImageUrl,
}: GalleryViewerProps) {
  const [activeImage, setActiveImage] = useState(0);
  const selectedImage = images[activeImage] ?? fallbackImageUrl;

  return (
    <section
      aria-label={`${productName} image gallery`}
      className="flex w-full min-w-0 flex-col gap-layout-sm lg:flex-row"
    >
      <StorefrontImage
        alt={`${productName}, view ${activeImage + 1} of ${images.length}`}
        aspectRatio="1 / 1"
        fallbackSrc={fallbackImageUrl}
        src={selectedImage}
        wrapperClassName="min-w-0 flex-1 rounded-lg"
        className="object-cover"
      />

      {images.length > 1 && (
        <div
          aria-label={`${productName} gallery thumbnails`}
          className="flex gap-layout-xs overflow-x-auto pb-layout-2xs lg:w-20 lg:shrink-0 lg:flex-col lg:overflow-visible"
          role="group"
        >
          {images.map((image, index) => {
            const isActive = activeImage === index;

            return (
              <button
                aria-current={isActive ? "true" : undefined}
                aria-label={`Show ${productName} image ${index + 1} of ${images.length}`}
                className={cn(
                  "min-h-control-standard min-w-control-standard shrink-0 rounded-md border-2 bg-surface p-1 transition-opacity duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2",
                  isActive
                    ? "border-selection-foreground opacity-100"
                    : "border-transparent opacity-60 hover:opacity-100",
                )}
                key={`${image}-${index}`}
                onClick={() => setActiveImage(index)}
                type="button"
              >
                <StorefrontImage
                  alt=""
                  aria-hidden="true"
                  aspectRatio="1 / 1"
                  decorative
                  fallbackSrc={fallbackImageUrl}
                  src={image}
                  wrapperClassName="h-16 w-16 rounded-sm"
                />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

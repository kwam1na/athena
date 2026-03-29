import React, { useState, forwardRef, useEffect } from "react";
import placeholder from "@/assets/placeholder.png";
import { useStoreContext } from "@/contexts/StoreContext";
import { getStoreFallbackImageUrl } from "@/lib/storeConfig";

const ImageWithFallback = forwardRef<
  HTMLImageElement,
  React.ImgHTMLAttributes<HTMLImageElement>
>(({ src, ...props }, ref) => {
  const { store } = useStoreContext();
  const fallbackImage = getStoreFallbackImageUrl(store, placeholder) || placeholder;

  // Use the src prop or fallback, and sync when src changes
  const [imageSrc, setImageSrc] = useState(src || fallbackImage);

  // Sync state when src prop changes
  useEffect(() => {
    setImageSrc(src || fallbackImage);
  }, [src, fallbackImage]);

  return (
    <img
      {...props}
      ref={ref}
      src={imageSrc}
      onError={() => setImageSrc(fallbackImage)}
    />
  );
});

ImageWithFallback.displayName = "ImageWithFallback";

export default ImageWithFallback;

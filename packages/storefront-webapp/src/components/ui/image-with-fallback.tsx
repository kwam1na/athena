import React, { useState, forwardRef } from "react";
import placeholder from "@/assets/placeholder.png";

const ImageWithFallback = forwardRef<
  HTMLImageElement,
  React.ImgHTMLAttributes<HTMLImageElement>
>(({ src, ...props }, ref) => {
  const [imageSrc, setImageSrc] = useState(src);

  return (
    <img
      {...props}
      ref={ref}
      src={imageSrc}
      onError={() => setImageSrc(placeholder)}
    />
  );
});

ImageWithFallback.displayName = "ImageWithFallback";

export default ImageWithFallback;

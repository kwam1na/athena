import * as React from "react";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";

export interface StorefrontImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "alt"> {
  alt: string;
  decorative?: boolean;
  fallbackSrc?: string;
  fallback?: React.ReactNode;
  aspectRatio?: React.CSSProperties["aspectRatio"];
  wrapperClassName?: string;
}

const StorefrontImage = React.forwardRef<
  HTMLImageElement,
  StorefrontImageProps
>(
  (
    {
      src,
      fallbackSrc,
      fallback,
      decorative = false,
      alt,
      aspectRatio,
      className,
      wrapperClassName,
      onError,
      ...props
    },
    ref,
  ) => {
    const [activeSrc, setActiveSrc] = React.useState(src);
    const [failed, setFailed] = React.useState(false);
    const attemptedFallback = React.useRef(false);

    React.useEffect(() => {
      setActiveSrc(src);
      setFailed(false);
      attemptedFallback.current = false;
    }, [src, fallbackSrc]);

    const handleError: React.ReactEventHandler<HTMLImageElement> = (event) => {
      onError?.(event);

      if (fallbackSrc && !attemptedFallback.current) {
        attemptedFallback.current = true;
        setActiveSrc(fallbackSrc);
        return;
      }

      setFailed(true);
    };

    return (
      <span
        className={cn(
          "relative block overflow-hidden bg-muted",
          wrapperClassName,
        )}
        style={aspectRatio ? { aspectRatio } : undefined}
      >
        {!failed ? (
          <img
            ref={ref}
            src={activeSrc}
            alt={decorative ? "" : alt}
            aria-hidden={decorative || undefined}
            className={cn("h-full w-full object-cover", className)}
            onError={handleError}
            {...props}
          />
        ) : (
          fallback ?? (
            <span
              className="flex min-h-24 w-full items-center justify-center gap-2 p-4 text-sm text-muted-foreground"
              role={decorative ? undefined : "img"}
              aria-label={decorative ? undefined : `${alt} unavailable`}
              aria-hidden={decorative || undefined}
            >
              <ImageOff aria-hidden="true" className="h-5 w-5" />
              {!decorative && <span>Image unavailable</span>}
            </span>
          )
        )}
      </span>
    );
  },
);
StorefrontImage.displayName = "StorefrontImage";

export { StorefrontImage };

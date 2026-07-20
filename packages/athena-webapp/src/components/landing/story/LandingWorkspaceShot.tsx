import { useCallback } from "react";
import { animate } from "animejs";

import { useSceneAnimation } from "./useSceneAnimation";

// A framed product shot of a real operations workspace, captured through the
// operations screenshot fixtures. Used for the landing hero and the story acts
// so every exhibit shares one frame and one entrance.
export function LandingWorkspaceShot({
  alt,
  animateIn = false,
  bordered = true,
  className,
  cropHeightFraction,
  eager = false,
  height,
  src,
  width,
}: {
  alt: string;
  /** When true, the shot fades/rises in as it enters view. Off by default. */
  animateIn?: boolean;
  /** When false, the frame drops its border so a shot can blend into a matching section. */
  bordered?: boolean;
  className?: string;
  /**
   * When set (0–1), the frame shows only the top fraction of the shot —
   * for captures whose lower region is empty chrome.
   */
  cropHeightFraction?: number;
  eager?: boolean;
  height: number;
  src: string;
  width: number;
}) {
  const rootRef = useSceneAnimation(
    useCallback(
      (root: HTMLElement) => {
        if (!animateIn) return;
        animate(root, {
          duration: 700,
          ease: "outQuad",
          opacity: { from: 0 },
          translateY: { from: 12 },
        });
      },
      [animateIn],
    ),
  );

  return (
    <figure
      ref={rootRef}
      className={`relative mx-auto w-full overflow-hidden rounded-xl bg-background ${bordered ? "border border-border" : ""} ${className ?? "max-w-2xl"}`}
      style={
        cropHeightFraction
          ? { aspectRatio: `${width} / ${height * cropHeightFraction}` }
          : undefined
      }
    >
      <img
        alt={alt}
        className={
          cropHeightFraction
            ? "block h-full w-full object-cover object-top"
            : "block h-auto w-full"
        }
        decoding="async"
        height={height}
        loading={eager ? "eager" : "lazy"}
        src={src}
        width={width}
      />
    </figure>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { animate } from "animejs";
import { Maximize2, X } from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { useAthenaTheme } from "@/lib/theme";
import { useSceneAnimation } from "./useSceneAnimation";

// A framed product shot of a real operations workspace, captured through the
// operations screenshot fixtures. Used for the landing hero and the story acts
// so every exhibit shares one frame and one entrance.
//
// The shots are wide (≈2:1) and shrink to an illegible sliver in a phone-width
// column. On mobile only, tapping a shot opens a full-screen lightbox where it
// fits the screen width; the reader pinch-zooms to inspect detail (the app's
// viewport allows user scaling). Desktop is left untouched — the shots are
// already legible there.
export function LandingWorkspaceShot({
  alt,
  animateIn = false,
  bordered = true,
  className,
  cropHeightFraction,
  eager = false,
  expandable = true,
  fadeBottom = false,
  height,
  src,
  srcDark,
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
  /** When false, the shot is never tap-to-expand, even on mobile. */
  expandable?: boolean;
  /**
   * When true, the shot's lower edge dissolves into the page (a mask gradient)
   * instead of ending on a hard line — pairs with a borderless frame so cropped
   * shots melt into the section rather than sitting in a box.
   */
  fadeBottom?: boolean;
  height: number;
  src: string;
  /** Charcoal-dark capture of the same workspace; shown when the theme is dark. */
  srcDark?: string;
  width: number;
}) {
  const { resolvedTheme } = useAthenaTheme();
  const activeSrc = resolvedTheme === "dark" && srcDark ? srcDark : src;
  const isMobile = useIsMobile();
  // Tap-to-expand is a mobile-only affordance: desktop shots are already legible.
  const interactive = expandable && isMobile;
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

  const [expanded, setExpanded] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const zoomImageRef = useRef<HTMLImageElement>(null);

  const close = useCallback(() => setExpanded(false), []);

  // While the lightbox is open: lock body scroll, move focus into the dialog and
  // restore it on close, close on Escape, and keep Tab from leaving the dialog.
  useEffect(() => {
    if (!expanded) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const opener = triggerRef.current;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        // Only the close button is focusable, so keep focus pinned to it.
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [expanded, close]);

  // A shot dropped out of interactivity (e.g. resized to desktop) must not leave
  // a stale lightbox mounted.
  useEffect(() => {
    if (!interactive && expanded) setExpanded(false);
  }, [interactive, expanded]);

  // Pinch-to-zoom scoped to the lightbox image. We drive a CSS transform on the
  // image and set `touch-action: none` on its layer so the browser never zooms
  // the visual viewport — otherwise the page stayed zoomed after the lightbox
  // closed. Double-tap toggles zoom; one finger pans while zoomed.
  useEffect(() => {
    if (!expanded) return;
    const layer = zoomLayerRef.current;
    const image = zoomImageRef.current;
    if (!layer || !image) return;

    const MAX_SCALE = 4;
    const g = {
      scale: 1,
      tx: 0,
      ty: 0,
      startDist: 0,
      startScale: 1,
      startMidX: 0,
      startMidY: 0,
      startTx: 0,
      startTy: 0,
      panning: false,
      panStartX: 0,
      panStartY: 0,
      lastTap: 0,
      lastTapX: 0,
      lastTapY: 0,
    };

    const apply = (smooth = false) => {
      image.style.transition = smooth ? "transform 200ms ease" : "none";
      image.style.transform = `translate(${g.tx}px, ${g.ty}px) scale(${g.scale})`;
    };
    apply();

    const distance = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const beginPan = (touch: Touch) => {
      if (g.scale <= 1) return;
      g.panning = true;
      g.panStartX = touch.clientX - g.tx;
      g.panStartY = touch.clientY - g.ty;
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        g.panning = false;
        g.startDist = distance(event.touches[0], event.touches[1]);
        g.startScale = g.scale;
        g.startMidX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        g.startMidY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        g.startTx = g.tx;
        g.startTy = g.ty;
        return;
      }
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        const now = Date.now();
        const isDoubleTap =
          now - g.lastTap < 300 &&
          Math.hypot(touch.clientX - g.lastTapX, touch.clientY - g.lastTapY) <
            30;
        if (isDoubleTap) {
          g.scale = g.scale > 1 ? 1 : 2.5;
          g.tx = 0;
          g.ty = 0;
          apply(true);
          g.lastTap = 0;
        } else {
          g.lastTap = now;
          g.lastTapX = touch.clientX;
          g.lastTapY = touch.clientY;
        }
        beginPan(touch);
      }
    };

    const onMove = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        const dist = distance(event.touches[0], event.touches[1]);
        const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        g.scale = Math.min(
          MAX_SCALE,
          Math.max(1, g.startScale * (dist / g.startDist)),
        );
        g.tx = g.startTx + (midX - g.startMidX);
        g.ty = g.startTy + (midY - g.startMidY);
        apply();
      } else if (event.touches.length === 1 && g.panning) {
        event.preventDefault();
        g.tx = event.touches[0].clientX - g.panStartX;
        g.ty = event.touches[0].clientY - g.panStartY;
        apply();
      }
    };

    const onEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        g.panning = false;
        if (g.scale <= 1.02) {
          g.scale = 1;
          g.tx = 0;
          g.ty = 0;
          apply(true);
        }
      } else if (event.touches.length === 1) {
        // Dropping from a pinch to one finger: re-baseline the pan.
        beginPan(event.touches[0]);
      }
    };

    layer.addEventListener("touchstart", onStart, { passive: false });
    layer.addEventListener("touchmove", onMove, { passive: false });
    layer.addEventListener("touchend", onEnd, { passive: false });
    layer.addEventListener("touchcancel", onEnd, { passive: false });

    return () => {
      layer.removeEventListener("touchstart", onStart);
      layer.removeEventListener("touchmove", onMove);
      layer.removeEventListener("touchend", onEnd);
      layer.removeEventListener("touchcancel", onEnd);
    };
  }, [expanded]);

  // Full shots render at their natural aspect (h-auto): light and dark are the
  // same width, so they show at identical scale — never zoomed relative to one
  // another, even if the dark capture differs by a few percent in height.
  // Cropped shots (cropHeightFraction) keep a fixed aspect + cover so the frame
  // shows only their top region.
  const imageClassName = cropHeightFraction
    ? "block h-full w-full object-cover object-top"
    : "block h-auto w-full";

  const image = (
    <img
      alt={alt}
      className={imageClassName}
      decoding="async"
      height={height}
      loading={eager ? "eager" : "lazy"}
      src={activeSrc}
      width={width}
    />
  );

  return (
    <figure
      ref={rootRef}
      className={`relative mx-auto w-full overflow-hidden rounded-xl bg-background ${bordered ? "border border-border" : ""} ${fadeBottom ? "[mask-image:linear-gradient(to_bottom,black_78%,transparent)]" : ""} ${className ?? "max-w-2xl"}`}
      style={
        cropHeightFraction
          ? { aspectRatio: `${width} / ${height * cropHeightFraction}` }
          : undefined
      }
    >
      {interactive ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`Expand image: ${alt}`}
          aria-haspopup="dialog"
          className="block w-full cursor-zoom-in appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {image}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-background/60 text-muted-foreground ring-1 ring-border/60 backdrop-blur-sm"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : (
        image
      )}

      {interactive && expanded && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={alt}
              className="fixed inset-0 z-[120] flex flex-col bg-app-canvas/90 backdrop-blur-sm"
              onClick={close}
            >
              {/* Fit the shot to screen width; pinch/double-tap zooms the image
                  itself (see the gesture effect) so the page never scales. */}
              <div
                ref={zoomLayerRef}
                className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-layout-md pb-layout-lg"
                style={{ touchAction: "none" }}
              >
                <img
                  ref={zoomImageRef}
                  alt={alt}
                  src={activeSrc}
                  className="block h-auto max-h-full w-full object-contain will-change-transform"
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </figure>
  );
}

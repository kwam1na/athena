import { useEffect, useRef } from "react";

import { useAthenaTheme } from "@/lib/theme";

// A recorded product clip of a real operations workspace — the moving sibling
// of LandingWorkspaceShot. The clip is muted, loops, and plays only while it is
// in view; with reduced motion (or without IntersectionObserver, e.g. jsdom)
// it stays on its poster frame. Light and dark captures of the same session
// swap with the page theme, matching how the static shots behave.
export function LandingWorkspaceVideo({
  bordered = true,
  className,
  height,
  label,
  poster,
  posterDark,
  src,
  srcDark,
  width,
}: {
  /** When false, the frame drops its border so a clip can blend into a matching section. */
  bordered?: boolean;
  className?: string;
  height: number;
  /** Describes the recording for assistive tech, like a shot's alt text. */
  label: string;
  poster: string;
  posterDark?: string;
  src: string;
  /** Charcoal-dark capture of the same session; shown when the theme is dark. */
  srcDark?: string;
  width: number;
}) {
  const { resolvedTheme } = useAthenaTheme();
  const isDark = resolvedTheme === "dark";
  const activeSrc = isDark && srcDark ? srcDark : src;
  const activePoster = isDark && posterDark ? posterDark : poster;
  const videoRef = useRef<HTMLVideoElement>(null);
  // Last playback position, carried across theme flips: the light and dark
  // clips are captures of the same session, so when the source remounts we
  // seek the new clip to where the old one left off instead of restarting.
  const resumeAtRef = useRef(0);

  // Drive playback from visibility: play while at least a quarter of the clip
  // is on screen, pause otherwise. Reduced motion never starts playback, so
  // the poster frame stands in as a static shot.
  // Track the playhead so a theme flip can hand it to the replacement clip.
  // The two captures can differ in length by a beat, so the seek wraps at the
  // new clip's duration — "roughly the same spot" beats snapping to zero.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const remember = () => {
      resumeAtRef.current = video.currentTime;
    };
    const seekToRemembered = () => {
      if (resumeAtRef.current > 0 && video.duration) {
        video.currentTime = resumeAtRef.current % video.duration;
      }
    };
    // The new source may already have metadata by the time the effect runs.
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seekToRemembered();
    }
    video.addEventListener("loadedmetadata", seekToRemembered);
    video.addEventListener("timeupdate", remember);
    return () => {
      video.removeEventListener("loadedmetadata", seekToRemembered);
      video.removeEventListener("timeupdate", remember);
    };
  }, [activeSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Autoplay can be rejected (e.g. power saving); the poster remains.
          video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [activeSrc]);

  return (
    <figure
      className={`relative mx-auto w-full overflow-hidden rounded-xl bg-background ${bordered ? "border border-border" : ""} ${className ?? "max-w-2xl"}`}
    >
      <video
        // Remount on theme flips so the browser swaps source and poster
        // together instead of holding the old stream's last frame.
        key={activeSrc}
        ref={videoRef}
        aria-label={label}
        className="block h-auto w-full"
        height={height}
        loop
        muted
        playsInline
        poster={activePoster}
        preload="metadata"
        src={activeSrc}
        width={width}
      />
    </figure>
  );
}

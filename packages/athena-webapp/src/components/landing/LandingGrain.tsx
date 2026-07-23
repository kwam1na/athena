// A tiled fractal-noise SVG, rendered once and repeated as a background. The
// public pages tell a paper-to-system story, so their surfaces carry a faint
// paper grain — fixed so copy, canvas panels, and screenshots all share it.
const GRAIN_TILE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E")`;

export function LandingGrain() {
  return (
    <div
      aria-hidden="true"
      // The tile is black noise; on charcoal it must be inverted to read as
      // light grain, and eased down so it stays a whisper.
      className="pointer-events-none fixed inset-0 z-[70] opacity-[0.08] dark:opacity-[0.05] dark:[filter:invert(1)]"
      style={{ backgroundImage: GRAIN_TILE }}
    />
  );
}

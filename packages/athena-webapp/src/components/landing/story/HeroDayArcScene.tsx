import { useCallback } from "react";
import { animate, stagger } from "animejs";

import { dayMoments, demoStore } from "./demoDay";
import { useSceneAnimation } from "./useSceneAnimation";

// Ambient hero visual: the store's day as an arc from open to close, with the
// five workspace moments lighting up in sequence.
export function HeroDayArcScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      animate(root.querySelectorAll("[data-arc-line]"), {
        duration: 1_800,
        ease: "inOutQuad",
        scaleX: { from: 0 },
      });
      animate(root.querySelectorAll("[data-arc-dot]"), {
        delay: stagger(320, { start: 150 }),
        duration: 450,
        ease: "outBack",
        opacity: { from: 0 },
        scale: { from: 0.4 },
      });
      animate(root.querySelectorAll("[data-arc-label]"), {
        delay: stagger(320, { start: 260 }),
        duration: 400,
        ease: "outQuad",
        opacity: { from: 0 },
        translateY: { from: 6 },
      });
    }, []),
  );

  return (
    <figure
      ref={rootRef}
      aria-label={`One operating day at ${demoStore.name}, from Opening Handoff to EOD Review.`}
      className="relative mx-auto w-full max-w-2xl rounded-xl border border-border bg-background p-layout-lg shadow-overlay"
    >
      <div className="flex items-center justify-between gap-layout-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Store day
          </p>
          <p className="mt-1 font-display text-lg leading-tight">{demoStore.name}</p>
        </div>
        <span className="rounded-full bg-success/10 px-layout-sm py-layout-xs text-xs font-medium text-success">
          Open to close
        </span>
      </div>

      <div className="mt-layout-xl">
        <div className="relative h-px bg-border">
          <div
            data-arc-line
            className="absolute inset-0 origin-left bg-primary/70"
            aria-hidden="true"
          />
        </div>
        <ol className="mt-[-5px] flex items-start justify-between">
          {dayMoments.map((moment) => (
            <li key={moment.key} className="flex w-16 flex-col items-center text-center sm:w-24">
              <span
                data-arc-dot
                className="h-[9px] w-[9px] rounded-full bg-primary"
                aria-hidden="true"
              />
              <span data-arc-label className="mt-layout-sm block">
                <span className="block font-numeric text-xs text-foreground">{moment.time}</span>
                <span className="mt-0.5 hidden text-[11px] leading-4 text-muted-foreground sm:block">
                  {moment.label}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}

import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";
import { Sparkles } from "lucide-react";

import { automationMoments, dayMoments } from "./demoDay";
import { useSceneAnimation } from "./useSceneAnimation";

// The day replayed, compressed: every moment Athena acted without being asked
// lights up in sequence. No invented counters — just the moments the visitor
// already walked through.
export function AutomationRevealScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      const timeline = createTimeline({
        defaults: { duration: 420, ease: "outQuad" },
      });
      timeline.add(root.querySelectorAll("[data-reveal-item]"), {
        delay: stagger(320),
        opacity: { from: 0.25 },
        translateX: { from: -10 },
      });
      timeline.add(
        root.querySelectorAll("[data-reveal-spark]"),
        { delay: stagger(320), ease: "outBack", scale: { from: 0 } },
        "<<+=100",
      );
    }, []),
  );

  return (
    <figure
      ref={rootRef}
      aria-label="The five moments in the day where Athena acted on its own."
      className="relative mx-auto w-full max-w-2xl rounded-xl border border-border bg-background p-layout-lg shadow-overlay"
    >
      <ol className="space-y-layout-sm">
        {automationMoments.map((moment, index) => (
          <li
            key={moment.key}
            data-reveal-item
            className="flex items-center gap-layout-md border-b border-border pb-layout-sm text-sm last:border-0 last:pb-0"
          >
            <span className="w-16 shrink-0 font-numeric text-xs text-muted-foreground">
              {dayMoments[index].time}
            </span>
            <span
              data-reveal-spark
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal/10 text-signal"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="text-foreground">{moment.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-layout-md text-sm leading-6 text-muted-foreground">
        Every decision stayed with the owner.
      </p>
    </figure>
  );
}

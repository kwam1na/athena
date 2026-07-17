import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";
import { ArrowRight, Check } from "lucide-react";

import { carryForward, demoStore, drawer, formatDemoMoney } from "./demoDay";
import { WorkspaceFrame } from "./SceneChrome";
import { useSceneAnimation } from "./useSceneAnimation";

const openingItems = [
  { key: "float", label: `Cash float confirmed — ${formatDemoMoney(drawer.openingFloat)}` },
  { key: "register", label: `Register ${demoStore.registerNumber} online` },
  {
    carried: true,
    key: "carry",
    label: `${carryForward.itemName} running low — carried from last close`,
  },
];

export function OpeningHandoffScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      const timeline = createTimeline({
        defaults: { duration: 420, ease: "outQuad" },
      });
      timeline.add(root.querySelectorAll("[data-open-item]"), {
        delay: stagger(240),
        opacity: { from: 0 },
        translateX: { from: -14 },
      });
      timeline.add(
        root.querySelectorAll("[data-open-check]"),
        { delay: stagger(240), ease: "outBack", scale: { from: 0 } },
        "<<+=120",
      );
      timeline.add(root.querySelectorAll("[data-open-status]"), {
        ease: "outBack",
        opacity: { from: 0 },
        scale: { from: 0.8 },
      });
      timeline.add(root.querySelectorAll("[data-open-footer]"), {
        opacity: { from: 0 },
        translateY: { from: 8 },
      });
    }, []),
  );

  return (
    <div ref={rootRef}>
      <WorkspaceFrame
        ariaLabel="The Opening Handoff workspace completing its start-of-day checklist."
        eyebrow="Store Ops"
        title="Opening Handoff"
        meta={
          <span
            data-open-status
            className="rounded-full bg-success/10 px-layout-sm py-layout-xs text-xs font-medium text-success"
          >
            Ready to run
          </span>
        }
      >
        <ul className="space-y-layout-sm">
          {openingItems.map((item) => (
            <li
              key={item.key}
              data-open-item
              className="flex items-center gap-layout-sm border-b border-border pb-layout-sm text-sm last:border-0 last:pb-0"
            >
              <span
                data-open-check
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="text-foreground">{item.label}</span>
              {item.carried ? (
                <span className="ml-auto hidden whitespace-nowrap rounded-full bg-signal/10 px-layout-sm py-layout-xs text-[11px] font-medium text-signal sm:inline-flex">
                  Carried forward
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <p
          data-open-footer
          className="mt-layout-md flex items-center gap-layout-sm text-sm text-muted-foreground"
        >
          <ArrowRight className="h-4 w-4 text-success" aria-hidden="true" />
          Opening Handoff is complete. The store day is ready to run.
        </p>
      </WorkspaceFrame>
    </div>
  );
}

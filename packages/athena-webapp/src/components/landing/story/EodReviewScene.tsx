import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";
import { ArrowRight, Check, Sparkles } from "lucide-react";

import {
  carryForward,
  dayTotals,
  drawer,
  formatDemoMoney,
  topItems,
} from "./demoDay";
import { WorkspaceFrame } from "./SceneChrome";
import { useSceneAnimation } from "./useSceneAnimation";

const eodBuckets = [
  {
    key: "sales",
    label: `Sales reconciled — ${formatDemoMoney(dayTotals.netSales)} across ${dayTotals.transactions} transactions`,
  },
  {
    key: "drawer",
    label: `Drawer closed — ${formatDemoMoney(Math.abs(drawer.variance))} variance approved`,
  },
  {
    key: "items",
    label: `Top items posted — ${topItems[0].name} led the day`,
  },
];

export function EodReviewScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      const timeline = createTimeline({
        defaults: { duration: 420, ease: "outQuad" },
      });
      timeline.add(root.querySelectorAll("[data-eod-item]"), {
        delay: stagger(260),
        opacity: { from: 0 },
        translateX: { from: -12 },
      });
      timeline.add(
        root.querySelectorAll("[data-eod-check]"),
        { delay: stagger(260), ease: "outBack", scale: { from: 0 } },
        "<<+=120",
      );
      timeline.add(root.querySelectorAll("[data-eod-flag]"), {
        ease: "outBack",
        opacity: { from: 0 },
        translateY: { from: 8 },
      });
      timeline.add(root.querySelectorAll("[data-eod-footer]"), {
        opacity: { from: 0 },
        translateY: { from: 8 },
      });
    }, []),
  );

  return (
    <div ref={rootRef}>
      <WorkspaceFrame
        ariaLabel="The EOD Review workspace completing the close and carrying work to tomorrow."
        eyebrow="Store Ops"
        title="EOD Review"
        meta={<span className="font-numeric text-xs text-muted-foreground">8:03 PM</span>}
      >
        <ul className="space-y-layout-sm">
          {eodBuckets.map((bucket) => (
            <li
              key={bucket.key}
              data-eod-item
              className="flex items-center gap-layout-sm border-b border-border pb-layout-sm text-sm last:border-0 last:pb-0"
            >
              <span
                data-eod-check
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="text-foreground">{bucket.label}</span>
            </li>
          ))}
        </ul>

        <div
          data-eod-flag
          className="mt-layout-md flex flex-wrap items-center justify-between gap-layout-sm rounded-md bg-signal/10 px-layout-sm py-layout-sm text-sm"
        >
          <span className="text-foreground">
            {carryForward.itemName} low stock ({carryForward.remaining} left)
          </span>
          <span className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-signal">
            Carried to tomorrow&apos;s Opening
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>

        <p
          data-eod-footer
          className="mt-layout-md flex items-center gap-layout-sm text-sm text-muted-foreground"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-signal" aria-hidden="true" />
          Athena completed EOD Review under store policy.
        </p>
      </WorkspaceFrame>
    </div>
  );
}

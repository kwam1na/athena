import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";
import { ArrowRight } from "lucide-react";

import { DailyCloseReadOnlyReport } from "@/components/operations/DailyCloseView";

import { carryForward, demoStore } from "./demoDay";
import { eodSnapshot } from "./demoDayFixtures";
import { WorkspaceExhibit, WorkspaceFrame } from "./SceneChrome";
import { useSceneAnimation } from "./useSceneAnimation";

// The real EOD Review read-only report for the story day: completed under
// store policy by automation, with the kente carry-forward handed to
// tomorrow's Opening Handoff.
export function EodReviewScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      const timeline = createTimeline({
        defaults: { duration: 550, ease: "outQuad" },
      });
      timeline.add(root.querySelectorAll("[data-eod-embed] > *"), {
        delay: stagger(180),
        opacity: { from: 0 },
        translateY: { from: 14 },
      });
      timeline.add(root.querySelectorAll("[data-eod-loop]"), {
        ease: "outBack",
        opacity: { from: 0 },
        translateY: { from: 8 },
      });
    }, []),
  );

  return (
    <div ref={rootRef}>
      <WorkspaceFrame
        ariaLabel="The EOD Review report: the close completed under store policy, sales and cash settled, with the kente scarf restock carried to tomorrow's opening."
        eyebrow="Store Ops"
        title="EOD Review"
        meta={<span className="font-numeric text-xs text-muted-foreground">8:03 PM</span>}
        className="max-w-none"
      >
        <WorkspaceExhibit>
          <div data-eod-embed className="space-y-layout-md">
            <DailyCloseReadOnlyReport
              currency={demoStore.currency}
              orgUrlSlug="demo"
              snapshot={eodSnapshot}
              storeUrlSlug="central"
            />
          </div>
        </WorkspaceExhibit>
        <p
          data-eod-loop
          className="mt-layout-md flex items-center gap-1 border-t border-border pt-layout-md text-sm font-medium text-primary"
        >
          {carryForward.itemName} ({carryForward.remaining} left) carried to tomorrow&apos;s
          Opening Handoff · 8:47 AM
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </p>
      </WorkspaceFrame>
    </div>
  );
}

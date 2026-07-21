import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";

import { CashControlsDashboardContent } from "@/components/cash-controls/CashControlsDashboard";

import { demoStore } from "./demoDay";
import { cashDashboardSnapshot } from "./demoDayFixtures";
import { WorkspaceExhibit } from "./SceneChrome";
import { useSceneAnimation } from "./useSceneAnimation";

// The real Cash Controls dashboard at closeout, rendered chromeless (no app
// shell) so it sits full-width against the section like the captured workspace
// shots: the story day's register session in review with its GH₵5 shortage
// surfaced, the counted cash still sitting in the drawer.
export function CashControlsScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      createTimeline({
        defaults: { duration: 550, ease: "outQuad" },
      }).add(root.querySelectorAll("[data-cash-embed] > div > *"), {
        delay: stagger(160),
        opacity: { from: 0 },
        translateY: { from: 14 },
      });
    }, []),
  );

  return (
    <div
      ref={rootRef}
      aria-label="The Cash Controls dashboard mid-closeout: the register session in review with its five-cedi shortage surfaced and the counted cash still in the drawer."
      className="w-full"
    >
      <WorkspaceExhibit>
        <div data-cash-embed>
          <CashControlsDashboardContent
            currency={demoStore.currency}
            dashboardSnapshot={cashDashboardSnapshot}
            hasFinancialDetailsAccess
            isLoading={false}
            orgUrlSlug="demo"
            storeUrlSlug="central"
          />
        </div>
      </WorkspaceExhibit>
    </div>
  );
}

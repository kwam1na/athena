import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";

import { CashControlsDashboardContent } from "@/components/cash-controls/CashControlsDashboard";

import { demoStore } from "./demoDay";
import { cashDashboardSnapshot } from "./demoDayFixtures";
import { AppShellExhibit, WorkspaceExhibit } from "./SceneChrome";
import { useSceneAnimation } from "./useSceneAnimation";

// The real Cash Controls dashboard at closeout: the product's
// CashControlsDashboardContent rendering the story day's closed register
// session, its approved variance, and the recorded deposit.
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

  // Presented the way the owner uses it: the real dashboard inside a browser
  // window wearing the app's shell.
  return (
    <div ref={rootRef}>
      <AppShellExhibit
        activeRailIcon="cash"
        ariaLabel="The Cash Controls dashboard mid-closeout, shown in the app as the owner sees it: the register session in review with its five-cedi shortage surfaced and the closeout deposit recorded."
        zoom={0.9}
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
      </AppShellExhibit>
    </div>
  );
}

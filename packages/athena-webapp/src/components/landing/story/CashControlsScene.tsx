import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";

import { CashControlsDashboardContent } from "@/components/cash-controls/CashControlsDashboard";

import { demoStore } from "./demoDay";
import { cashDashboardSnapshot } from "./demoDayFixtures";
import { WorkspaceExhibit } from "./SceneChrome";
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

  // The dashboard brings its own workspace header, so the frame here is
  // chromeless — just the card, a timestamp, and the exhibit.
  return (
    <div ref={rootRef}>
      <figure
        aria-label="The Cash Controls dashboard after closeout: the closed register session with its approved five-cedi shortage and the recorded end-of-day deposit."
        className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-background p-layout-md text-left text-foreground shadow-overlay sm:p-layout-lg"
      >
        <span className="absolute right-layout-md top-layout-md font-numeric text-xs text-muted-foreground">
          5:40 PM
        </span>
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
      </figure>
    </div>
  );
}

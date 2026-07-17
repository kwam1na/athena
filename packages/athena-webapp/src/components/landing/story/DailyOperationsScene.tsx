import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";

import { StorePulseSummaryView } from "@/components/store-pulse/StorePulseSummaryView";
import { currencyFormatter } from "~/shared/currencyFormatter";

import { demoStore } from "./demoDay";
import { morningPulseSummary } from "./demoDayFixtures";
import { WorkspaceExhibit, WorkspaceFrame } from "./SceneChrome";
import { useSceneAnimation } from "./useSceneAnimation";

const pulseCurrencyFormatter = currencyFormatter(demoStore.currency);

// The real Daily Operations store pulse, rendered mid-morning: the actual
// StorePulseSummaryView fed the story day's fixture summary.
export function DailyOperationsScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      createTimeline({
        defaults: { duration: 550, ease: "outQuad" },
      }).add(root.querySelectorAll("[data-pulse-embed] > section > *"), {
        delay: stagger(160),
        opacity: { from: 0 },
        translateY: { from: 14 },
      });
    }, []),
  );

  return (
    <div ref={rootRef}>
      <WorkspaceFrame
        ariaLabel="The Daily Operations store pulse mid-morning: net sales, transactions, items sold, the sales trend, top items, and how customers paid."
        eyebrow="Store Ops"
        title="Daily Operations"
        meta={<span className="font-numeric text-xs text-muted-foreground">11:20 AM</span>}
        className="max-w-none"
      >
        <WorkspaceExhibit>
          <div data-pulse-embed>
            <StorePulseSummaryView
              canViewFinancialDetails
              chartDescription="Synced sales through 11:20 AM."
              currencyFormatter={pulseCurrencyFormatter}
              onPulseWindowChange={() => undefined}
              pulseWindow="today"
              showPulseWindowFilter={false}
              summary={morningPulseSummary}
              topItemsTitle="Top items so far"
            />
          </div>
        </WorkspaceExhibit>
      </WorkspaceFrame>
    </div>
  );
}

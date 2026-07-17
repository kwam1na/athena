import { useCallback } from "react";
import { createTimeline, utils } from "animejs";
import { Banknote, WifiOff } from "lucide-react";

import { CartItems } from "@/components/pos/CartItems";
import { TotalsDisplay } from "@/components/pos/TotalsDisplay";
import { currencyFormatter } from "~/shared/currencyFormatter";

import { demoStore, tracedSale } from "./demoDay";
import {
  offlinePresentation,
  pendingSyncPresentation,
  posCartLines,
} from "./demoDayFixtures";
import { PosSyncBadge, WorkspaceExhibit, WorkspaceFrame } from "./SceneChrome";
import { useSceneAnimation } from "./useSceneAnimation";

const posFormatter = currencyFormatter(demoStore.currency);

// The register mid-sale, built from the product's own cart components: the
// real CartItems and TotalsDisplay render the traced sale, the connection
// drops, and the sale completes anyway with the product's sync language.
export function PosSaleScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      const online = root.querySelector("[data-pos-conn-online]");
      const offline = root.querySelector("[data-pos-conn-offline]");
      if (online) utils.set(online, { opacity: 1 });
      if (offline) utils.set(offline, { opacity: 0 });

      const timeline = createTimeline({
        defaults: { duration: 420, ease: "outQuad" },
      });
      timeline.add(root.querySelectorAll("[data-pos-cart]"), {
        opacity: { from: 0 },
        translateY: { from: 12 },
      });
      timeline.add(
        root.querySelectorAll("[data-pos-totals]"),
        { opacity: { from: 0 }, translateY: { from: 8 } },
        "-=150",
      );
      if (online && offline) {
        timeline.add(online, { duration: 220, opacity: 0 }, "+=350");
        timeline.add(
          offline,
          { duration: 260, ease: "outBack", opacity: 1, scale: { from: 0.85 } },
          "<<+=80",
        );
      }
      timeline.add(
        root.querySelectorAll("[data-pos-done]"),
        { ease: "outBack", opacity: { from: 0 }, translateY: { from: 12 } },
        "+=350",
      );
    }, []),
  );

  return (
    <div ref={rootRef}>
      <WorkspaceFrame
        ariaLabel="The register completing a sale while offline: the cart holds the kente scarf and black soap, and the completed sale waits to sync."
        eyebrow="Point of Sale"
        title={`Register ${demoStore.registerNumber}`}
        meta={
          <span className="relative inline-flex items-center">
            <span data-pos-conn-online className="absolute right-0 opacity-0">
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-success/10 px-layout-sm py-layout-xs text-xs font-medium text-success">
                Connected
              </span>
            </span>
            <span data-pos-conn-offline className="inline-flex items-center gap-1">
              <WifiOff className="h-3.5 w-3.5 text-warning-foreground" aria-hidden="true" />
              <PosSyncBadge presentation={offlinePresentation} chipRole="offline" />
            </span>
          </span>
        }
      >
        <div data-pos-cart>
          <WorkspaceExhibit>
            <CartItems cartItems={posCartLines} density="compact" readOnly />
          </WorkspaceExhibit>
        </div>
        <div data-pos-totals className="mt-layout-md border-t border-border pt-layout-sm">
          <WorkspaceExhibit>
            <TotalsDisplay
              density="compact"
              items={[
                { formatter: posFormatter, label: "Subtotal", value: tracedSale.total },
                { formatter: posFormatter, highlight: true, label: "Total", value: tracedSale.total },
              ]}
            />
          </WorkspaceExhibit>
        </div>
        <div
          data-pos-done
          className="mt-layout-md flex flex-wrap items-center justify-between gap-layout-sm rounded-md bg-surface px-layout-sm py-layout-sm text-sm"
        >
          <span className="flex items-center gap-layout-sm text-foreground">
            <Banknote className="h-4 w-4 text-success" aria-hidden="true" />
            Sale completed · Receipt #{tracedSale.receiptNumber} · Cash
          </span>
          <PosSyncBadge presentation={pendingSyncPresentation} chipRole="pending" />
        </div>
      </WorkspaceFrame>
    </div>
  );
}

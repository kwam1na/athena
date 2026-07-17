import { useCallback } from "react";
import { createTimeline, stagger, utils } from "animejs";
import { Banknote, WifiOff } from "lucide-react";

import { demoStore, formatDemoMoney, tracedSale } from "./demoDay";
import { SyncChip, WorkspaceFrame } from "./SceneChrome";
import { animateAmount, useSceneAnimation } from "./useSceneAnimation";

// The register completes the traced sale while the connection is down: items
// ring up, the network drops, the sale still completes and waits to sync.
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
      timeline.add(root.querySelectorAll("[data-pos-item]"), {
        delay: stagger(320),
        opacity: { from: 0 },
        translateY: { from: 10 },
      });
      animateAmount(root.querySelector("[data-pos-total]"), {
        delay: 350,
        format: (value) => formatDemoMoney(Math.round(value / 100) * 100),
        to: tracedSale.total,
      });
      if (online && offline) {
        timeline.add(online, { duration: 220, opacity: 0 }, "+=250");
        timeline.add(offline, { duration: 260, ease: "outBack", opacity: 1, scale: { from: 0.85 } }, "<<+=80");
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
        ariaLabel="The register completing a sale while offline."
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
              <SyncChip status="offline" />
            </span>
          </span>
        }
      >
        <ul className="space-y-layout-sm">
          {tracedSale.items.map((item) => (
            <li
              key={item.name}
              data-pos-item
              className="flex items-center justify-between gap-layout-sm border-b border-border pb-layout-sm text-sm last:border-0"
            >
              <span className="text-foreground">{item.name}</span>
              <span className="font-numeric text-muted-foreground">
                {formatDemoMoney(item.price)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-layout-md flex items-center justify-between border-t border-border pt-layout-md">
          <span className="text-sm font-medium text-foreground">Total</span>
          <span data-pos-total className="font-numeric text-2xl text-foreground">
            {formatDemoMoney(tracedSale.total)}
          </span>
        </div>
        <div
          data-pos-done
          className="mt-layout-md flex flex-wrap items-center justify-between gap-layout-sm rounded-md bg-surface px-layout-sm py-layout-sm text-sm"
        >
          <span className="flex items-center gap-layout-sm text-foreground">
            <Banknote className="h-4 w-4 text-success" aria-hidden="true" />
            Sale completed · Receipt #{tracedSale.receiptNumber} · Cash
          </span>
          <SyncChip status="pending_sync" />
        </div>
      </WorkspaceFrame>
    </div>
  );
}

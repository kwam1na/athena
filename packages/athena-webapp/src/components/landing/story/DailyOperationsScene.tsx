import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";
import { CircleDot } from "lucide-react";

import {
  demoStore,
  formatDemoMoney,
  morningSnapshot,
} from "./demoDay";
import { WorkspaceFrame } from "./SceneChrome";
import { animateAmount, useSceneAnimation } from "./useSceneAnimation";

// Sales bars through mid-morning; the day is still filling in.
const morningBars = [22, 41, 30, 56, 48, 34, 0, 0, 0, 0, 0, 0];

export function DailyOperationsScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      const timeline = createTimeline({
        defaults: { duration: 500, ease: "outQuad" },
      });
      timeline.add(root.querySelectorAll("[data-ops-metric]"), {
        delay: stagger(140),
        opacity: { from: 0 },
        translateY: { from: 10 },
      });
      animateAmount(root.querySelector("[data-ops-net]"), {
        delay: 150,
        format: (value) => formatDemoMoney(Math.round(value / 100) * 100),
        to: morningSnapshot.netSales,
      });
      animateAmount(root.querySelector("[data-ops-tx]"), {
        delay: 250,
        duration: 700,
        format: (value) => `${Math.round(value)}`,
        to: morningSnapshot.transactions,
      });
      animateAmount(root.querySelector("[data-ops-items]"), {
        delay: 350,
        duration: 700,
        format: (value) => `${Math.round(value)}`,
        to: morningSnapshot.itemsSold,
      });
      timeline.add(
        root.querySelectorAll("[data-ops-bar]"),
        {
          delay: stagger(70),
          duration: 550,
          ease: "outCubic",
          scaleY: { from: 0 },
        },
        "<<+=200",
      );
      timeline.add(root.querySelectorAll("[data-ops-row]"), {
        delay: stagger(180),
        opacity: { from: 0 },
        translateX: { from: -10 },
      });
      timeline.add(root.querySelectorAll("[data-ops-attention]"), {
        duration: 900,
        ease: "inOutQuad",
        opacity: [{ to: 0.35 }, { to: 1 }],
      });
    }, []),
  );

  return (
    <div ref={rootRef}>
      <WorkspaceFrame
        ariaLabel="The Daily Operations workspace showing the store pulse mid-morning."
        eyebrow="Store Ops"
        title="Daily Operations"
        meta={<span className="font-numeric text-xs text-muted-foreground">11:20 AM</span>}
      >
        <div className="grid grid-cols-3 gap-layout-sm">
          {[
            { key: "net", label: "Net sales", ref: "data-ops-net", value: formatDemoMoney(morningSnapshot.netSales) },
            { key: "tx", label: "Transactions", ref: "data-ops-tx", value: `${morningSnapshot.transactions}` },
            { key: "items", label: "Items sold", ref: "data-ops-items", value: `${morningSnapshot.itemsSold}` },
          ].map((metric) => (
            <div key={metric.key} data-ops-metric className="border-l border-border pl-layout-sm">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {metric.label}
              </p>
              <p
                {...{ [metric.ref]: true }}
                className="mt-1 font-numeric text-xl text-foreground"
              >
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-layout-md flex h-20 items-end gap-1.5 border-t border-border pt-layout-md" aria-hidden="true">
          {morningBars.map((height, index) => (
            <div
              key={`${height}-${index}`}
              data-ops-bar
              className={`flex-1 origin-bottom rounded-t-sm ${height === 0 ? "bg-muted" : "bg-signal/60"}`}
              style={{ height: `${Math.max(height, 4)}%` }}
            />
          ))}
        </div>

        <div className="mt-layout-md space-y-layout-sm text-sm">
          <p data-ops-row className="flex items-center gap-layout-sm text-muted-foreground">
            <CircleDot className="h-4 w-4 text-success" aria-hidden="true" />
            Register {demoStore.registerNumber} · open since 8:47 AM
          </p>
          <p
            data-ops-row
            className="flex items-center justify-between gap-layout-sm rounded-md bg-surface px-layout-sm py-layout-sm"
          >
            <span data-ops-attention className="text-foreground">
              Stock check requested · 1 needs attention
            </span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              Routed to Operations
            </span>
          </p>
        </div>
      </WorkspaceFrame>
    </div>
  );
}

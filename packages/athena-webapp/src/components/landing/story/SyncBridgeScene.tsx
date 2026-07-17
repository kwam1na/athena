import { useCallback, useEffect, useRef } from "react";
import { createTimeline, onScroll, utils, type Timeline } from "animejs";
import { useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight } from "lucide-react";

import {
  demoStaff,
  demoStore,
  drawer,
  formatDemoMoney,
  tracedSale,
} from "./demoDay";
import { SyncChip } from "./SceneChrome";

// The local-first centerpiece: the completed POS sale travels the seam into
// the register session in Cash Controls, scrubbed by the visitor's scroll.
// Reduced motion (and environments without scroll observers) get the finished
// frame: the sale already landed in the books.
export function SyncBridgeScene() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();

  const build = useCallback((root: HTMLElement) => {
    const chip = root.querySelector("[data-bridge-chip]");
    const row = root.querySelector("[data-bridge-row]");
    const expected = root.querySelector("[data-bridge-expected]");
    const delta = root.querySelector("[data-bridge-delta]");
    const pending = root.querySelector("[data-bridge-pending]");
    const synced = root.querySelector("[data-bridge-synced]");
    if (!chip || !row || !expected) return;

    if (pending) utils.set(pending, { opacity: 1 });
    if (synced) utils.set(synced, { opacity: 0 });

    const expectedCounter = { value: drawer.expectedBeforeSale };
    const timeline = createTimeline({
      autoplay: onScroll({
        enter: "bottom-=10% top",
        leave: "center+=20% center",
        sync: 0.25,
        target: root,
      }),
      defaults: { ease: "linear" },
    });
    timeline.add(chip, {
      duration: 300,
      opacity: [{ from: 0, to: 1 }],
      scale: { from: 0.7, to: 1 },
    });
    timeline.add(chip, { duration: 500, translateX: { from: -36, to: 36 } }, "<<+=150");
    if (pending && synced) {
      timeline.add(pending, { duration: 150, opacity: 0 }, "<<+=300");
      timeline.add(synced, { duration: 150, opacity: 1 }, "<");
    }
    timeline.add(chip, { duration: 180, opacity: 0, scale: 0.8 }, "-=120");
    timeline.add(
      row,
      { duration: 350, ease: "outQuad", opacity: { from: 0, to: 1 }, translateY: { from: 10, to: 0 } },
      "-=100",
    );
    timeline.add(
      expectedCounter,
      {
        duration: 400,
        onUpdate: () => {
          expected.textContent = formatDemoMoney(
            Math.round(expectedCounter.value / 100) * 100,
          );
        },
        value: drawer.expectedAfterSale,
      },
      "<<",
    );
    if (delta) {
      timeline.add(
        delta,
        { duration: 300, ease: "outBack", opacity: { from: 0, to: 1 }, scale: { from: 0.7, to: 1 } },
        "<<+=100",
      );
    }
    return () => {
      timeline.revert();
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reducedMotion) return;
    if (typeof IntersectionObserver === "undefined") return;
    const cleanup = build(root);
    return () => {
      cleanup?.();
    };
  }, [build, reducedMotion]);

  return (
    <div
      ref={rootRef}
      className="grid items-stretch gap-layout-sm lg:grid-cols-[1fr_minmax(5rem,auto)_1fr]"
    >
      <figure
        aria-label="The completed sale on the register, waiting to sync."
        className="rounded-xl border border-border bg-background p-layout-md shadow-surface"
      >
        <div className="flex items-center justify-between gap-layout-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Point of Sale
          </p>
          <span className="relative inline-flex items-center">
            <span data-bridge-pending className="absolute right-0 opacity-0">
              <SyncChip status="pending_sync" />
            </span>
            <span data-bridge-synced>
              <SyncChip status="synced" />
            </span>
          </span>
        </div>
        <div className="mt-layout-md rounded-md bg-surface p-layout-sm text-sm">
          <p className="flex items-center justify-between gap-layout-sm">
            <span className="font-medium text-foreground">Receipt #{tracedSale.receiptNumber}</span>
            <span className="font-numeric text-xs text-muted-foreground">{tracedSale.time}</span>
          </p>
          <ul className="mt-layout-sm space-y-1 text-muted-foreground">
            {tracedSale.items.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-layout-sm">
                <span>{item.name}</span>
                <span className="font-numeric">{formatDemoMoney(item.price)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-layout-sm flex items-center justify-between border-t border-border pt-layout-sm text-foreground">
            <span>Cash</span>
            <span className="font-numeric font-medium">{formatDemoMoney(tracedSale.total)}</span>
          </p>
        </div>
        <p className="mt-layout-sm text-xs leading-5 text-muted-foreground">
          Recorded on the device the moment it happened.
        </p>
      </figure>

      <div className="relative flex items-center justify-center py-layout-sm lg:py-0" aria-hidden="true">
        <ArrowRight className="hidden h-5 w-5 text-muted-foreground lg:block" />
        <ArrowDown className="h-5 w-5 text-muted-foreground lg:hidden" />
        <span
          data-bridge-chip
          className="absolute inline-flex items-center whitespace-nowrap rounded-full bg-signal px-layout-sm py-layout-xs text-xs font-semibold text-signal-foreground shadow-surface"
        >
          Sale · {formatDemoMoney(tracedSale.total)}
        </span>
      </div>

      <figure
        aria-label="The same sale appearing in the register session in Cash Controls."
        className="rounded-xl border border-border bg-background p-layout-md shadow-surface"
      >
        <div className="flex items-center justify-between gap-layout-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Cash Ops · Register session
          </p>
          <span className="font-numeric text-xs text-muted-foreground">{demoStore.registerNumber}</span>
        </div>
        <ul className="mt-layout-md space-y-layout-sm text-sm">
          <li className="flex items-center justify-between gap-layout-sm border-b border-border pb-layout-sm text-muted-foreground">
            <span>8:47 AM · Opening float</span>
            <span className="font-numeric">{formatDemoMoney(drawer.openingFloat)}</span>
          </li>
          <li
            data-bridge-row
            className="flex items-center justify-between gap-layout-sm rounded-md bg-signal/10 px-layout-sm py-layout-sm"
          >
            <span className="text-foreground">
              {tracedSale.time} · Sale · {demoStaff.cashierFirstName}
            </span>
            <span className="font-numeric font-medium text-foreground">
              {formatDemoMoney(tracedSale.total)}
            </span>
          </li>
        </ul>
        <p className="mt-layout-md flex items-center justify-between border-t border-border pt-layout-sm text-sm">
          <span className="text-muted-foreground">Expected in drawer</span>
          <span className="flex items-center gap-layout-sm">
            <span
              data-bridge-delta
              className="rounded-full bg-success/10 px-layout-sm py-layout-xs font-numeric text-[11px] font-medium text-success"
            >
              +{formatDemoMoney(tracedSale.total)}
            </span>
            <span data-bridge-expected className="font-numeric text-lg text-foreground">
              {formatDemoMoney(drawer.expectedAfterSale)}
            </span>
          </span>
        </p>
      </figure>
    </div>
  );
}

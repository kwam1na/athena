import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";
import { Check, Landmark } from "lucide-react";

import { demoStaff, demoStore, drawer, formatDemoMoney } from "./demoDay";
import { WorkspaceFrame } from "./SceneChrome";
import { animateAmount, useSceneAnimation } from "./useSceneAnimation";

// Closeout at the drawer: counted meets expected, the small variance is
// surfaced and approved, and the deposit leaves the drawer.
export function CashControlsScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      const timeline = createTimeline({
        defaults: { duration: 450, ease: "outQuad" },
      });
      timeline.add(root.querySelectorAll("[data-cash-metric]"), {
        delay: stagger(160),
        opacity: { from: 0 },
        translateY: { from: 10 },
      });
      animateAmount(root.querySelector("[data-cash-expected]"), {
        delay: 150,
        format: (value) => formatDemoMoney(Math.round(value / 100) * 100),
        to: drawer.expectedCash,
      });
      animateAmount(root.querySelector("[data-cash-counted]"), {
        delay: 300,
        format: (value) => formatDemoMoney(Math.round(value / 100) * 100),
        to: drawer.countedCash,
      });
      timeline.add(
        root.querySelectorAll("[data-cash-variance]"),
        { ease: "outBack", opacity: { from: 0 }, scale: { from: 0.75 } },
        "+=200",
      );
      timeline.add(root.querySelectorAll("[data-cash-approved]"), {
        opacity: { from: 0 },
        translateX: { from: -10 },
      });
      timeline.add(root.querySelectorAll("[data-cash-deposit]"), {
        opacity: { from: 0 },
        translateX: { from: -10 },
      });
    }, []),
  );

  const varianceLabel = `Short ${formatDemoMoney(Math.abs(drawer.variance))}`;

  return (
    <div ref={rootRef}>
      <WorkspaceFrame
        ariaLabel="A register session closing out in Cash Controls."
        eyebrow="Cash Ops"
        title="Register sessions"
        meta={<span className="font-numeric text-xs text-muted-foreground">5:40 PM</span>}
      >
        <p className="text-sm text-muted-foreground">
          Register {demoStore.registerNumber} · opened 8:47 AM · {demoStaff.cashierFirstName}
        </p>

        <div className="mt-layout-md grid grid-cols-2 gap-layout-sm">
          <div data-cash-metric className="rounded-md bg-surface p-layout-sm">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Expected
            </p>
            <p data-cash-expected className="mt-1 font-numeric text-xl text-foreground">
              {formatDemoMoney(drawer.expectedCash)}
            </p>
          </div>
          <div data-cash-metric className="rounded-md bg-surface p-layout-sm">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Counted
            </p>
            <p className="mt-1 flex items-center gap-layout-sm">
              <span data-cash-counted className="font-numeric text-xl text-foreground">
                {formatDemoMoney(drawer.countedCash)}
              </span>
              <span
                data-cash-variance
                className="rounded-full bg-warning/10 px-layout-sm py-layout-xs text-[11px] font-medium text-warning-foreground"
              >
                {varianceLabel}
              </span>
            </p>
          </div>
        </div>

        <ul className="mt-layout-md space-y-layout-sm text-sm">
          <li data-cash-approved className="flex items-center gap-layout-sm text-foreground">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            Variance reviewed and approved · {demoStaff.managerFirstName}
          </li>
          <li data-cash-deposit className="flex items-center gap-layout-sm text-foreground">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal/10 text-signal">
              <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            Deposit recorded · {formatDemoMoney(drawer.depositAmount)}
          </li>
        </ul>
      </WorkspaceFrame>
    </div>
  );
}

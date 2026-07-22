import { animate } from "animejs";
import { useReducedMotion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";

import { PosHubBody } from "@/components/pos/PointOfSaleView";
import type { POSStorePulseWindow } from "@/components/pos/sales-pulse/POSSalesPulseView";
import {
  POS_HUB_NOW,
  posHubCurrencyFormatter,
  posHubManagerFeatures,
  posHubManagerPulseByWindow,
  posHubScheduleSummary,
  posHubStaffFeatures,
  posHubStaffSummary,
} from "@/stories/operations/posHubFixtures";

type Role = "manager" | "staff";

const ROLES: Array<{ caption: string; id: Role; label: string }> = [
  {
    caption: "The owner's view: every launcher, and the whole pulse — live.",
    id: "manager",
    label: "Store manager",
  },
  {
    caption: "A cashier's view: the tools to sell, and today's count — no store financials.",
    id: "staff",
    label: "Staff",
  },
];

// The POS hub, filtered to a role — rendered live from authored fixture data, so
// the manager's store-pulse tabs (today / this week / this month / all time) are
// genuinely interactive. Staff see the launchers they can act on and a bare
// transaction count. A minimal toggle swaps between the two.
export function PosHubRoleSwitcher() {
  const [role, setRole] = useState<Role>("manager");
  const [pulseWindow, setPulseWindow] =
    useState<POSStorePulseWindow>("this_week");
  const active = ROLES.find((entry) => entry.id === role) ?? ROLES[0];
  const reduceMotion = useReducedMotion();

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // The manager and staff hubs differ a lot in height, so swapping them lets the
  // browser's scroll anchoring nudge the viewport. Record where the control sits
  // before the swap and correct any drift before paint so it stays put.
  const anchorTopRef = useRef<number | null>(null);
  const didMountRef = useRef(false);

  const selectRole = (next: Role) => {
    if (next === role) return;
    // Swap synchronously; the fade below is a fire-and-forget entrance.
    anchorTopRef.current = rootRef.current?.getBoundingClientRect().top ?? null;
    setRole(next);
  };

  useLayoutEffect(() => {
    const anchorTop = anchorTopRef.current;
    anchorTopRef.current = null;
    if (anchorTop != null && rootRef.current) {
      const drift = rootRef.current.getBoundingClientRect().top - anchorTop;
      if (drift !== 0) window.scrollBy(0, drift);
    }

    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (reduceMotion || !bodyRef.current) return;
    animate(bodyRef.current, {
      duration: 280,
      ease: "outQuad",
      opacity: { from: 0 },
    });
    // Only fade on a role change, not on pulse-window changes within a role.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const body =
    role === "manager" ? (
      <PosHubBody
        currencyFormatter={posHubCurrencyFormatter}
        hasFullAdminAccess
        nowOverride={POS_HUB_NOW}
        onPulseWindowChange={setPulseWindow}
        posFeatures={posHubManagerFeatures}
        pulseWindow={pulseWindow}
        scheduleSummary={posHubScheduleSummary}
        todaySummary={posHubManagerPulseByWindow[pulseWindow]}
      />
    ) : (
      <PosHubBody
        currencyFormatter={posHubCurrencyFormatter}
        hasFullAdminAccess={false}
        nowOverride={POS_HUB_NOW}
        onPulseWindowChange={() => {}}
        posFeatures={posHubStaffFeatures}
        pulseWindow="today"
        scheduleSummary={posHubScheduleSummary}
        todaySummary={posHubStaffSummary}
      />
    );

  return (
    <div
      className="w-full space-y-layout-2xl [overflow-anchor:none]"
      data-testid="pos-hub-exhibit"
      ref={rootRef}
    >
      <div className="flex flex-wrap items-center gap-x-layout-lg gap-y-layout-sm">
        <div
          aria-label="POS hub role"
          className="inline-flex rounded-full border border-border bg-surface p-1 shadow-surface"
          role="group"
        >
          {ROLES.map((entry) => {
            const isActive = entry.id === role;

            return (
              <button
                aria-pressed={isActive}
                className={`rounded-full px-layout-md py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary-soft text-primary shadow-surface"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                key={entry.id}
                onClick={() => selectRole(entry.id)}
                type="button"
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {active.caption}
        </p>
      </div>

      {/* Live hub exhibit, scaled down to sit as a product shot in the column
          (zoom reflows height, unlike transform). The launcher tiles are
          decorative here, so their real in-app links are disabled — the store
          pulse below stays interactive. */}
      <div
        className="will-change-[opacity] [zoom:0.8] [&_[data-testid=athena-pos-hub-ready]]:pointer-events-none"
        ref={bodyRef}
      >
        {body}
      </div>
    </div>
  );
}

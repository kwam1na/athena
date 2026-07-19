import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Banknote,
  Boxes,
  ClipboardCheck,
  ShoppingBag,
  Store,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { FadeIn } from "../common/FadeIn";

export type SharedDemoRoutes = {
  cash: string;
  inventory: string;
  operations: string;
  orders: string;
  pos: string;
};

const highlights = ["Register open", "Pickup ready", "Work to review"];

const workflows = [
  [
    "Make a sale",
    "Open the register and complete a sale.",
    Banknote,
    "pos",
  ],
  [
    "Review stock",
    "Update an item and see its stock position change.",
    Boxes,
    "inventory",
  ],
  [
    "Manage cash",
    "Record a cash action and review the drawer.",
    ClipboardCheck,
    "cash",
  ],
  [
    "Fulfill an order",
    "Move the ready pickup order forward.",
    ShoppingBag,
    "orders",
  ],
  [
    "Review today",
    "See the store day and outstanding work.",
    Store,
    "operations",
  ],
] as const;

export function SharedDemoOwnerHome({ routes }: { routes: SharedDemoRoutes }) {
  return (
    <FadeIn className="mx-auto w-full max-w-6xl overflow-auto px-layout-xs py-layout-lg sm:px-layout-md md:py-layout-2xl">
      <section aria-labelledby="shared-demo-heading">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Owner demo
        </p>
        <h1
          id="shared-demo-heading"
          className="mt-layout-sm max-w-4xl font-display text-5xl font-light leading-[0.98] tracking-[-0.035em] text-foreground sm:text-6xl"
        >
          Run Osu Studio
        </h1>
        <p className="mt-layout-md max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
          Explore a working day across sales, stock, cash, orders, and daily
          operations.
        </p>
        <p className="mt-layout-md inline-flex items-center gap-layout-xs text-sm text-muted-foreground">
          Changes reset at the start of every hour.
        </p>
      </section>

      <section
        aria-labelledby="shared-demo-overview"
        className="mt-layout-2xl grid gap-layout-lg border-y border-border py-layout-lg md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
      >
        <div>
          <h2
            id="shared-demo-overview"
            className="text-base font-semibold tracking-[-0.01em] text-foreground"
          >
            Today at a glance
          </h2>
          <p className="mt-layout-xs max-w-xl text-sm leading-6 text-muted-foreground">
            This is a shared demo. Activity may change while you explore.
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-layout-lg gap-y-layout-sm md:justify-end">
          {highlights.map((highlight) => (
            <li
              key={highlight}
              className="inline-flex items-center gap-layout-xs whitespace-nowrap text-sm font-light text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-success"
              />
              {highlight}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="shared-demo-workflows"
        className="py-layout-2xl"
      >
        <h2
          id="shared-demo-workflows"
          className="text-xl font-medium tracking-[-0.015em] text-foreground"
        >
          Choose where to start
        </h2>
        <p className="mt-layout-xs text-sm leading-6 text-muted-foreground">
          Each workspace uses the same demo store.
        </p>
        <div className="mt-layout-lg grid gap-layout-sm sm:grid-cols-2">
          {workflows.map(([title, detail, Icon, route]) => (
            <Link
              key={route}
              to={routes[route]}
              className={cn(
                "group flex min-h-28 items-start gap-layout-md rounded-xl border border-border bg-surface-raised p-layout-lg text-left shadow-surface transition-[background-color,border-color,box-shadow,transform] duration-fast ease-standard hover:border-primary-border hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none",
                route === "pos" && "sm:col-span-2",
              )}
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-layout-sm">
                  <span className="font-medium tracking-[-0.005em] text-foreground">
                    {title}
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast ease-standard group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-focus-visible:-translate-y-0.5 group-focus-visible:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
                  />
                </span>
                <span className="mt-layout-xs block text-sm leading-6 text-muted-foreground">
                  {detail}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </FadeIn>
  );
}

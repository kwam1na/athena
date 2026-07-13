import {
  Banknote,
  Boxes,
  ClipboardCheck,
  MessageCircleMore,
  ShoppingBag,
  Store,
} from "lucide-react";

export type SharedDemoRoutes = {
  cash: string;
  inventory: string;
  operations: string;
  orders: string;
  pos: string;
  reports: string;
  staff: string;
};

const workflows = [
  ["Make a sale", "Use Athena's real register and follow the sale into the operating record.", Banknote, "pos"],
  ["Manage stock", "Adjust a seeded item and inspect how its stock position changes.", Boxes, "inventory"],
  ["Control cash", "Record an operational cash action without moving money outside Athena.", ClipboardCheck, "cash"],
  ["Fulfill an order", "Advance a seeded order without charging or contacting a customer.", ShoppingBag, "orders"],
  ["Coordinate the team", "Use today's shared work to leave clear context for the store team.", MessageCircleMore, "staff"],
  ["Run today", "Start today's store day and review the work that still needs attention.", Store, "operations"],
] as const;

export function SharedDemoOwnerHome({ routes }: { routes: SharedDemoRoutes }) {
  return (
    <main className="mx-auto w-full max-w-7xl overflow-auto px-layout-xs py-layout-md sm:px-layout-md md:py-layout-xl">
      <section aria-labelledby="shared-demo-heading" className="border-b border-border pb-layout-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Owner view · Shared demo</p>
        <h1 id="shared-demo-heading" className="mt-layout-sm font-display text-4xl font-light leading-tight text-foreground sm:text-5xl">
          See what is happening today
        </h1>
        <p className="mt-layout-md max-w-2xl text-base leading-7 text-muted-foreground">
          This synthetic store is ready for an active day. Explore the same sales, stock, cash, orders, team context, and daily work an owner uses to understand the business from anywhere.
        </p>
      </section>

      <section aria-labelledby="shared-demo-attention" className="border-b border-border py-layout-lg">
        <h2 id="shared-demo-attention" className="text-xl font-semibold text-foreground">What needs attention</h2>
        <p className="mt-layout-sm max-w-3xl leading-7 text-muted-foreground">
          A pickup order is ready, the register is open, and today's operating work is waiting for review. Because this store is shared, you may also see activity from another visitor.
        </p>
      </section>

      <section aria-labelledby="shared-demo-workflows" className="py-layout-xl">
        <h2 id="shared-demo-workflows" className="text-xl font-semibold text-foreground">Where to look next</h2>
        <p className="mt-layout-xs text-sm text-muted-foreground">Choose any starting point. There is no required tour.</p>
        <div className="mt-layout-lg grid gap-layout-sm md:grid-cols-2">
          {workflows.map(([title, detail, Icon, route]) => (
            <a key={route} href={routes[route]} className="group flex min-h-20 items-center gap-layout-md rounded-lg border border-border bg-background p-layout-md text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-signal" />
              <span><span className="block font-medium text-foreground">{title}</span><span className="mt-layout-2xs block text-sm leading-6 text-muted-foreground">{detail}</span></span>
            </a>
          ))}
        </div>
        <div className="mt-layout-lg border-t border-border pt-layout-md">
          <p className="text-sm leading-6 text-muted-foreground">Athena's reports are read-only in the demo and reflect these writes where the current product already supports that connection.</p>
          <a href={routes.reports} className="mt-layout-sm inline-flex min-h-11 items-center text-sm font-semibold text-signal underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Open Reports</a>
        </div>
      </section>
    </main>
  );
}

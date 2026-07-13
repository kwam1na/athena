import { Link } from "@tanstack/react-router";

export function SharedDemoRestrictedSurface({ homeHref }: { homeHref: string }) {
  return (
    <section
      aria-labelledby="shared-demo-restricted-title"
      className="mx-auto my-layout-xl w-full max-w-2xl border-y border-border py-layout-xl"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">
        Shared demo boundary
      </p>
      <h1
        className="mt-layout-sm font-display text-3xl font-light"
        id="shared-demo-restricted-title"
      >
        This area is not available in the shared demo.
      </h1>
      <p className="mt-layout-md max-w-xl leading-7 text-muted-foreground">
        Identity, permissions, configuration, exports, and destructive
        administration stay protected. Return to the owner view to explore
        sales, stock, cash, fulfillment, team coordination, and daily work.
      </p>
      <Link
        className="mt-layout-lg inline-flex min-h-11 items-center font-semibold text-signal underline-offset-4 hover:underline"
        to={homeHref}
      >
        Return to owner view
      </Link>
    </section>
  );
}

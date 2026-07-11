import { PublicLayout } from "./-public-layout";

export function Index() {
  return (
    <PublicLayout>
      <main className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-7xl items-center px-layout-md py-layout-3xl sm:px-layout-xl">
        <div className="max-w-3xl space-y-layout-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">
            Athena for owner-led retail
          </p>
          <h1 className="font-display text-5xl font-light leading-[0.98] text-foreground sm:text-7xl">
            See how the business is doing today.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
            Athena brings sales history and the products behind each day into
            one clear operating view.
          </p>
        </div>
      </main>
    </PublicLayout>
  );
}

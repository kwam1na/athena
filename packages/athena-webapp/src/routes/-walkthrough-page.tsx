import { WalkthroughRequestForm } from "@/components/landing/WalkthroughRequestForm";
import { PublicLayout } from "./-public-layout";

export function WalkthroughPage() {
  return (
    <PublicLayout>
      <main className="mx-auto w-full max-w-5xl px-layout-md py-layout-2xl sm:px-layout-xl sm:py-layout-3xl">
        <header className="max-w-3xl border-b border-border/70 pb-layout-xl">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Athena walkthrough
          </p>
          <h1 className="mt-layout-sm font-display text-4xl font-light leading-tight text-foreground sm:text-5xl">
            Show us what you need to see clearly.
          </h1>
          <p className="mt-layout-md max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Share a little about your business and where better sales or inventory visibility would help.
          </p>
        </header>

        <section aria-labelledby="request-details" className="grid gap-layout-xl py-layout-xl md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <div>
            <h2 id="request-details" className="font-display text-2xl font-light text-foreground">
              Request details
            </h2>
            <p className="mt-layout-sm max-w-sm text-sm leading-6 text-muted-foreground">
              We use this information only to review and respond to your walkthrough request.
            </p>
          </div>
          <WalkthroughRequestForm />
        </section>
      </main>
    </PublicLayout>
  );
}

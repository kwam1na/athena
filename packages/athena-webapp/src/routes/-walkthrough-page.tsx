import { LandingGrain } from "@/components/landing/LandingGrain";
import { WalkthroughRequestForm } from "@/components/landing/WalkthroughRequestForm";
import { PublicLayout } from "./-public-layout";
import { FadeIn } from "@/components/common/FadeIn";

export function WalkthroughPage() {
  return (
    <PublicLayout hideSecondaryNav showThemeToggle>
      <LandingGrain />
      <FadeIn className="relative mx-auto w-full max-w-5xl px-layout-md pb-[8rem] pt-layout-3xl sm:px-layout-xl">
        {/* The landing story's dot grid carries onto the interest page — the
            same primitive, radially faded behind the header so the form field
            still reads on clean ground. */}
        <div
          aria-hidden="true"
          // The radial fade must reach full transparency before every edge of
          // this box, or the box clips dots that are still partly visible and
          // leaves a hard line. Anchored to the base with center 30%/68% and a
          // 45% radius, keeping the nearest edges (bottom, left) past the
          // transparent stop.
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[36rem] text-foreground/[0.12] [mask-image:radial-gradient(45%_45%_at_30%_68%,black,transparent_62%)]"
          style={{
            backgroundImage:
              "radial-gradient(currentColor 1px, transparent 1.5px)",
            backgroundSize: "26px 26px",
          }}
        />
        <header className="relative max-w-3xl border-b border-border/70 pb-layout-xl">
          <h1 className="font-display text-4xl font-light leading-tight text-foreground sm:text-5xl">
            Tell us what you need to see clearly.
          </h1>
          <p className="mt-layout-md max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Share a little about your business and where better sales or inventory visibility would help.
          </p>
        </header>

        <section aria-labelledby="request-details" className="relative grid gap-layout-xl py-layout-xl md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <div>
            <h2 id="request-details" className="font-display text-2xl font-light text-foreground">
              Your details
            </h2>
            <p className="mt-layout-sm max-w-sm text-sm leading-6 text-muted-foreground">
              We use this information only to review and follow up on your interest.
            </p>
          </div>
          <WalkthroughRequestForm />
        </section>
      </FadeIn>
    </PublicLayout>
  );
}

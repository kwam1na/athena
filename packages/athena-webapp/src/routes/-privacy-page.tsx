import { Link } from "@tanstack/react-router";

import { LandingGrain } from "@/components/landing/LandingGrain";
import { WALKTHROUGH_PRIVACY_CONTACT } from "@/lib/marketing/walkthroughPrivacy";
import { PublicLayout } from "./-public-layout";
import { FadeIn } from "@/components/common/FadeIn";

export function PrivacyPage() {
  return (
    <PublicLayout hideSecondaryNav showThemeToggle>
      <LandingGrain />
      <FadeIn className="relative mx-auto w-full max-w-5xl px-layout-md pb-[8rem] pt-layout-3xl sm:px-layout-xl">
        {/* Matches the interest page: the story's dot grid pools low behind the
            notice, fully faded before every edge so nothing clips. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[36rem] text-foreground/[0.12] [mask-image:radial-gradient(45%_45%_at_30%_68%,black,transparent_62%)]"
          style={{
            backgroundImage:
              "radial-gradient(currentColor 1px, transparent 1.5px)",
            backgroundSize: "26px 26px",
          }}
        />
        <header className="relative border-b border-border/70 pb-layout-xl">
          <h1 className="font-display text-4xl font-light leading-tight text-foreground sm:text-5xl">
            Privacy and retention details
          </h1>
          <p className="mt-layout-md max-w-2xl text-base leading-7 text-muted-foreground">
            This notice explains how we handle the information you share when you register interest.
          </p>
        </header>

        <div className="relative space-y-layout-xl py-layout-xl text-base leading-7 text-foreground">
          <NoticeSection title="Information collected">
            <p>
              The form collects your name, work email, business name, a short description of what you need, and a phone number only when you choose to provide one.
            </p>
          </NoticeSection>

          <NoticeSection title="How the information is used">
            <p>
              We use these details to review your interest, understand the business context, and follow up about Athena. The details are available only to the restricted Athena operators responsible for this process. A transactional email provider processes the fields needed to notify that team.
            </p>
          </NoticeSection>

          <NoticeSection title="Retention and redaction">
            <p>
              An open request is retained for up to 180 days without activity. A resolved or abandoned request is redacted 180 days after that status change. Limited non-content replay-prevention evidence may remain for up to 365 days.
            </p>
          </NoticeSection>

          <NoticeSection title="Export or deletion requests">
            {WALKTHROUGH_PRIVACY_CONTACT ? (
              <p>
                Email{" "}
                <a
                  className="text-foreground underline underline-offset-4"
                  href={`mailto:${WALKTHROUGH_PRIVACY_CONTACT}`}
                >
                  {WALKTHROUGH_PRIVACY_CONTACT}
                </a>{" "}
                to request an export or deletion. We verify control of
                the email stored with the request before acting and do not
                provide an automatic bypass when that address is unavailable.
              </p>
            ) : (
              <p>
                Interest submissions are not open yet. We will publish an
                owner-approved privacy contact here before accepting them.
              </p>
            )}
          </NoticeSection>

          <p className="border-t border-border/70 pt-layout-lg text-sm text-muted-foreground">
            This page describes how we handle the interest form only. It does not claim a broader certification or legal regime.
          </p>

          <Link
            to="/walkthrough"
            className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Return to register interest
          </Link>
        </div>
      </FadeIn>
    </PublicLayout>
  );
}

function NoticeSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-layout-sm sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] sm:gap-layout-xl">
      <h2 className="font-display text-2xl font-light text-foreground">{title}</h2>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}

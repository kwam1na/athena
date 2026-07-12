import { createFileRoute, Link } from "@tanstack/react-router";

import { PublicLayout } from "./-public-layout";
import {
  WALKTHROUGH_PRIVACY_CONTACT,
} from "@/lib/marketing/walkthroughPrivacy";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Athena walkthrough privacy details" },
      {
        name: "description",
        content: "How Athena handles information submitted with a walkthrough request.",
      },
    ],
  }),
});

export function PrivacyPage() {
  return (
    <PublicLayout>
      <main className="mx-auto w-full max-w-4xl px-layout-md py-layout-2xl sm:px-layout-xl sm:py-layout-3xl">
        <header className="border-b border-border/70 pb-layout-xl">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Walkthrough requests
          </p>
          <h1 className="mt-layout-sm font-display text-4xl font-light leading-tight text-foreground sm:text-5xl">
            Privacy and retention details
          </h1>
          <p className="mt-layout-md max-w-2xl text-base leading-7 text-muted-foreground">
            This pre-launch notice explains how Athena handles the information collected through the walkthrough form.
          </p>
        </header>

        <div className="space-y-layout-xl py-layout-xl text-base leading-7 text-foreground">
          <NoticeSection title="Information collected">
            <p>
              The form collects your name, work email, business name, a short description of what you need, and a phone number only when you choose to provide one.
            </p>
          </NoticeSection>

          <NoticeSection title="How the information is used">
            <p>
              Athena uses these details to review your request, understand the business context, and follow up about a product walkthrough. The request is available only to the restricted Athena operators responsible for this process. A transactional email provider processes the fields needed to notify that team.
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
                to request an export or deletion. Athena verifies control of
                the email stored with the request before acting and does not
                provide an automatic bypass when that address is unavailable.
              </p>
            ) : (
              <p>
                Walkthrough requests are not open yet. Athena will publish an
                owner-approved privacy contact here before accepting requests.
              </p>
            )}
          </NoticeSection>

          <p className="border-t border-border/70 pt-layout-lg text-sm text-muted-foreground">
            This page describes the walkthrough-request process only. It does not claim a broader certification or legal regime.
          </p>

          <Link
            to="/walkthrough"
            className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Return to walkthrough request
          </Link>
        </div>
      </main>
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

import { cn } from "@/lib/utils";
import { SHARED_DEMO_STAFF_STORY } from "~/shared/sharedDemoStory";

export function SharedDemoManagerSignInGuidance({
  className,
}: {
  className?: string;
}) {
  return (
    <section
      className={cn(
        "w-full rounded-md border border-border bg-muted/40 px-4 py-3 text-left",
        className,
      )}
    >
      <p className="text-sm font-medium text-foreground">
        Demo staff sign-in
      </p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Use <strong>{SHARED_DEMO_STAFF_STORY.cashier.username}</strong> for
        cashier access or{" "}
        <strong>{SHARED_DEMO_STAFF_STORY.manager.username}</strong> for manager
        access. Both use PIN <strong>1111</strong>.
      </p>
    </section>
  );
}

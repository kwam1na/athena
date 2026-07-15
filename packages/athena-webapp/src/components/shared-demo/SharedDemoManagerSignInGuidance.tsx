import { cn } from "@/lib/utils";

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
        Use <strong>kofi</strong> for manager access or <strong>ama</strong> for
        cashier access. Both use PIN <strong>1111</strong>.
      </p>
    </section>
  );
}

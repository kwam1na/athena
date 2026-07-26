import type { PropsWithChildren } from "react";

type StorybookShellProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
  description: string;
}>;

export function StorybookShell({
  eyebrow,
  title,
  description,
  children,
}: StorybookShellProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 md:px-10 md:py-16">
        <header className="max-w-3xl space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-2-foreground">
            {eyebrow}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
          <p className="text-base leading-7 text-muted-foreground">{description}</p>
        </header>
        <div className="grid gap-8">{children}</div>
      </div>
    </main>
  );
}

export function StorybookSection({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description: string }>) {
  return (
    <section className="grid gap-5 border-t border-border pt-8 md:grid-cols-3">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 md:col-span-2">{children}</div>
    </section>
  );
}

export function StorybookList({ items }: { items: readonly string[] }) {
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li
          className="rounded-lg border border-border bg-card p-4 text-sm leading-6 text-card-foreground"
          key={item}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function StorybookStatus({
  status,
  children,
}: PropsWithChildren<{ status: string }>) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {status}
      </p>
      <div className="mt-2 text-sm leading-6 text-card-foreground">{children}</div>
    </div>
  );
}

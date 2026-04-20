import type { PropsWithChildren, ReactNode } from "react";

import { cn } from "@/lib/utils";

type StorybookShellProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
  description: string;
  className?: string;
}>;

export function StorybookShell({
  eyebrow,
  title,
  description,
  className,
  children,
}: StorybookShellProps) {
  return (
    <div className={cn("bg-background text-foreground", className)}>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 py-10 md:px-10 md:py-14">
        <header className="max-w-3xl space-y-4 border-b border-border pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            {eyebrow}
          </p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              {title}
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              {description}
            </p>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-12">{children}</div>
      </div>
    </div>
  );
}

export function StorybookSection({
  title,
  description,
  children,
}: PropsWithChildren<{
  title: string;
  description: string;
}>) {
  return (
    <section className="grid gap-6 border-b border-border pb-10 md:grid-cols-[minmax(0,280px)_1fr] md:gap-10">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

export function StorybookList({
  items,
  className,
}: {
  items: readonly string[];
  className?: string;
}) {
  return (
    <ul className={cn("grid gap-3", className)}>
      {items.map((item) => (
        <li
          key={item}
          className="border-b border-border/70 pb-3 text-sm leading-6 text-foreground/90 last:border-b-0 last:pb-0"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function StorybookCallout({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-5">
      <p className="text-sm font-semibold tracking-tight">{title}</p>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">{children}</div>
    </div>
  );
}

export function StorybookPillRow({
  items,
}: {
  items: readonly ReactNode[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <div
          key={`${index}-${String(item)}`}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

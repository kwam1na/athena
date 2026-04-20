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
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-layout-2xl px-6 py-layout-xl md:px-10 md:py-layout-2xl">
        <header className="max-w-4xl space-y-layout-sm border-b border-border pb-layout-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            {eyebrow}
          </p>
          <div className="space-y-3">
            <h1 className="font-display text-[clamp(2.75rem,4.6vw,4.75rem)] leading-[0.95] tracking-[-0.05em] text-foreground">
              {title}
            </h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
              {description}
            </p>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-layout-2xl">{children}</div>
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
    <section className="grid gap-layout-lg border-b border-border pb-layout-xl md:grid-cols-[minmax(0,280px)_1fr] md:gap-layout-xl">
      <div className="space-y-2">
        <h2 className="font-display text-2xl tracking-[-0.04em] text-foreground">
          {title}
        </h2>
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
    <div className="rounded-[calc(var(--radius)*1.35)] border border-border bg-surface-raised/90 p-layout-md shadow-surface">
      <p className="text-sm font-semibold tracking-tight text-foreground">{title}</p>
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
    <div className="flex flex-wrap gap-layout-xs">
      {items.map((item, index) => (
        <div
          key={`${index}-${String(item)}`}
          className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

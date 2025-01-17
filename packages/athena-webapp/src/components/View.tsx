import { cn } from "@/lib/utils";
import React from "react";

export default function View({
  children,
  className,
  header,
  hideHeaderBottomBorder = false,
  hideBorder = false,
}: {
  children: React.ReactNode;
  className?: string;
  header?: React.ReactNode;
  hideHeaderBottomBorder?: boolean;
  hideBorder?: boolean;
}) {
  return (
    <section className={cn("", className)}>
      <div
        className={`flex flex-col h-full ${hideBorder ? "" : "border border-1"} rounded-md pb-8`}
      >
        {header && (
          <header className={`${hideHeaderBottomBorder ? "" : "border-b"}`}>
            {header}
          </header>
        )}
        <main>{children}</main>
      </div>
    </section>
  );
}

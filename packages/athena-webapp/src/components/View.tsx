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
        className={`h-full ${hideBorder ? "" : "border border-1"} rounded-lg`}
      >
        {header && (
          <header
            className={`${hideHeaderBottomBorder ? "" : "border-b"} overflow-hidden`}
          >
            {header}
          </header>
        )}
        <main>{children}</main>
      </div>
    </section>
  );
}

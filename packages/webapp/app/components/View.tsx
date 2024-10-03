import { cn } from "@/lib/utils";
import React from "react";

export default function View({
  children,
  className,
  header,
  hideHeaderBottomBorder = false,
}: {
  children: React.ReactNode;
  className?: string;
  header?: React.ReactNode;
  hideHeaderBottomBorder?: boolean;
}) {
  return (
    <section className={cn("flex-grow h-full", className)}>
      <div className="flex flex-col h-full border border-1 rounded-md pb-8">
        {header && (
          <header
            className={`${hideHeaderBottomBorder ? "" : "border-b"} px-8 py-2`}
          >
            {header}
          </header>
        )}
        <main className="flex-grow overflow-auto">{children}</main>
      </div>
    </section>
  );
}

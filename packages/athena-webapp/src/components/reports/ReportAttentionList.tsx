import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

import {
  getReportDestinationPath,
  type ReportDestination,
} from "./reportDestinations";

export type ReportAttentionItem = {
  id: string;
  title: string;
  detail: string;
  destination: ReportDestination;
};

export function ReportAttentionList({
  items,
}: {
  items: ReportAttentionItem[];
}) {
  if (items.length === 0) {
    return (
      <section
        aria-labelledby="attention-title"
        className="rounded-lg border border-border bg-surface p-layout-md"
      >
        <h2 className="font-semibold" id="attention-title">
          Needs attention
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No reporting exceptions need review for this period.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="attention-title"
      className="rounded-lg border border-border bg-surface p-layout-md"
    >
      <h2 className="font-semibold" id="attention-title">
        Needs attention
      </h2>
      <ul className="mt-layout-sm divide-y divide-border">
        {items.map((item) => {
          const path = getReportDestinationPath(item.destination);
          const route = path
            ? `/$orgUrlSlug/store/$storeUrlSlug/${path}`
            : null;
          return (
            <li
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              key={item.id}
            >
              <div className="min-w-0">
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.detail}</p>
              </div>
              {route ? (
                <Link
                  aria-label={`Review ${item.title.toLowerCase()}`}
                  className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
                  params
                  search
                  to={route as never}
                >
                  Review <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Source detail unavailable
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

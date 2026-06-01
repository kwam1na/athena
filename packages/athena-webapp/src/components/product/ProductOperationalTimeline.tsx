import { useQuery } from "convex/react";
import { Circle, History } from "lucide-react";

import { api } from "~/convex/_generated/api";
import { useProduct } from "~/src/contexts/ProductContext";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { getRelativeTime } from "~/src/lib/utils";
import { FadeIn } from "../common/FadeIn";
import { Badge } from "../ui/badge";

type ProductOperationalTimelineEvent = {
  createdAt: number;
  id: string;
  message: string;
  subject: {
    id: string;
    label?: string;
    sku?: string;
    type: string;
  };
  type: string;
};

function formatTimelineTime(timestamp: number) {
  return new Intl.DateTimeFormat([], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatEventType(type: string) {
  return type
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function TimelineRow({
  event,
  isActiveSku,
}: {
  event: ProductOperationalTimelineEvent;
  isActiveSku: boolean;
}) {
  return (
    <li className="flex items-start gap-layout-sm">
      <Circle className="mt-layout-sm h-2 w-2 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 border-b border-border py-layout-sm first:pt-0 last:border-b-0 last:pb-0">
        <div className="flex flex-wrap items-start justify-between gap-layout-md">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-5 text-foreground">
              {event.message}
            </p>
            <p className="mt-layout-xs text-xs text-muted-foreground">
              <time
                dateTime={new Date(event.createdAt).toISOString()}
                title={formatTimelineTime(event.createdAt)}
              >
                {getRelativeTime(event.createdAt)}
              </time>{" "}
              · {formatEventType(event.type)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-layout-xs pt-0.5">
            {event.subject.sku ? (
              <Badge
                className="font-mono font-medium text-muted-foreground"
                size="sm"
                variant="outline"
              >
                {event.subject.sku}
              </Badge>
            ) : (
              <Badge size="sm" variant="outline">
                Product
              </Badge>
            )}
            {isActiveSku ? (
              <Badge
                className="border-success/30 bg-success/10 text-success"
                size="sm"
                variant="outline"
              >
                Current SKU
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function ProductOperationalTimeline() {
  const { activeStore } = useGetActiveStore();
  const { activeProduct, activeProductVariant } = useProduct();

  const events = useQuery(
    api.operations.operationalEvents.listProductOperationalTimeline,
    activeStore?._id && activeProduct?._id
      ? {
          productId: activeProduct._id,
          storeId: activeStore._id,
        }
      : "skip",
  ) as ProductOperationalTimelineEvent[] | undefined;

  if (!activeStore || !activeProduct || events === undefined) return null;

  return (
    <FadeIn className="space-y-layout-md">
      <div className="flex items-center justify-between gap-layout-md">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium text-muted-foreground">
            Operational timeline
          </h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {events.length === 1 ? "1 event" : `${events.length} events`}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/30 px-layout-md py-layout-sm text-sm leading-6 text-muted-foreground">
          No operational events recorded for this product.
        </p>
      ) : (
        <div className="max-h-[22rem] overflow-y-auto pr-layout-xs">
          <ol
            aria-label="Product operational timeline"
            className="space-y-layout-sm"
          >
            {events.map((event) => (
              <TimelineRow
                event={event}
                isActiveSku={event.subject.id === activeProductVariant?.id}
                key={event.id}
              />
            ))}
          </ol>
        </div>
      )}
    </FadeIn>
  );
}

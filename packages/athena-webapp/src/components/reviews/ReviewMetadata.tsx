import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Id } from "../../../convex/_generated/dataModel";

interface ReviewMetadataProps {
  orderId: string;
  orderNumber: string;
  createdByStoreFrontUserId: Id<"storeFrontUser"> | Id<"guest">;
  creationTime: number;
}

export function ReviewMetadata({
  orderId,
  orderNumber,
  createdByStoreFrontUserId,
  creationTime,
}: ReviewMetadataProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(p) => ({
            ...p,
            storeUrlSlug: p.storeUrlSlug!,
            orgUrlSlug: p.orgUrlSlug!,
            orderSlug: orderId,
          })}
          search={{ o: getOrigin() }}
          className="flex items-center gap-2"
        >
          <p className="text-sm text-muted-foreground">Order# {orderNumber}</p>
        </Link>

        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
          params={(p) => ({
            ...p,
            storeUrlSlug: p.storeUrlSlug!,
            orgUrlSlug: p.orgUrlSlug!,
            userId: createdByStoreFrontUserId,
          })}
          search={{ o: getOrigin() }}
          className="flex items-center gap-2"
        >
          <p className="text-sm text-muted-foreground">
            {`by User-${createdByStoreFrontUserId.slice(-5)}`}
          </p>
        </Link>
      </div>

      <p className="text-xs text-muted-foreground">·</p>

      <p className="text-sm text-muted-foreground">
        {new Date(creationTime).toLocaleString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>

      <p className="text-xs text-muted-foreground">·</p>

      <p className="text-sm text-muted-foreground">
        {new Date(creationTime).toLocaleString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}

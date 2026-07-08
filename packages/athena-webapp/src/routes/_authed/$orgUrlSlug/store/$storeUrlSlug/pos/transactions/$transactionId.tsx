import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import TransactionView from "~/src/components/pos/transactions/TransactionView";
import { NotFoundView } from "~/src/components/states/not-found/NotFoundView";

const transactionSearchSchema = z.object({
  intent: z.enum(["void"]).optional(),
  o: z.string().optional(),
});

function TransactionNotFoundComponent({ data }: { data?: unknown }) {
  const { orgUrlSlug, storeUrlSlug } = Route.useParams();
  const payload =
    data &&
    typeof data === "object" &&
    "data" in data &&
    data.data &&
    typeof data.data === "object"
      ? (data.data as { org?: boolean })
      : {};

  const entity = payload.org ? "organization" : "store";
  const name = payload.org ? orgUrlSlug : storeUrlSlug;

  return <NotFoundView entity={entity} entityIdentifier={name} />;
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
)({
  component: TransactionView,
  validateSearch: transactionSearchSchema,
  notFoundComponent: TransactionNotFoundComponent,
});

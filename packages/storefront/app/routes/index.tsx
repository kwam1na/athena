import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@athena-webapp/convex/_generated/api";
import type { Id } from "@athena-webapp/convex/_generated/dataModel";
import { useStore } from "../components/providers/StoreProvider";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { store } = useStore();

  const { data } = useSuspenseQuery(
    convexQuery(api.inventory.products.getAll, {
      storeId: "m1773nc3djfy0qg7m0wp4v1bn9786n2y" as Id<"store">,
    })
  );

  return (
    <div>
      {data?.map(({ _id, name }: { _id: string; name: string }) => (
        <div key={_id}>{name}</div>
      ))}
      <div>{JSON.stringify(store?.config)}</div>
    </div>
  );
}

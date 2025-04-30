import { api } from "@athena-webapp/convex/_generated/api";
import type { Id } from "@athena-webapp/convex/_generated/dataModel";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useStore } from "./providers/StoreProvider";

export function Products() {
  const { store } = useStore();

  console.log(store);

  const { data: products } = useSuspenseQuery(
    convexQuery(api.inventory.products.getAll, {
      storeId: store._id,
    })
  );

  return (
    <>
      {products?.map(({ _id, name }: { _id: string; name: string }) => (
        <div key={_id}>{name}</div>
      ))}
    </>
  );
}

import { getStore } from "@/api/storefront";
import { queryOptions } from "@tanstack/react-query";

export const storeQueries = {
  store: ({ asNewUser }: { asNewUser: boolean }) =>
    queryOptions({
      queryKey: ["store"],
      staleTime: 0,
      queryFn: () => getStore(asNewUser),
    }),
};

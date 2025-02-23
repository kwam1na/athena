import { storeQueries } from "@/lib/queries/store";
import { useQuery } from "@tanstack/react-query";

export const useGetStore = (
  { enabled }: { enabled?: boolean } = { enabled: true }
) => {
  return useQuery({ ...storeQueries.store(), enabled });
};

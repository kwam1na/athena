import { storeQueries } from "@/lib/queries/store";
import { useQuery } from "@tanstack/react-query";

export const useGetStore = (
  { enabled, asNewUser }: { enabled?: boolean; asNewUser: boolean } = {
    enabled: true,
    asNewUser: true,
  }
) => {
  return useQuery({ ...storeQueries.store({ asNewUser }), enabled });
};

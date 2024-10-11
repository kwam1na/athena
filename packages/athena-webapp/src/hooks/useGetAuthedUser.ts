import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

export function useGetAuthedUser() {
  const user = useQuery(api.app.getCurrentUser);

  return user;
}

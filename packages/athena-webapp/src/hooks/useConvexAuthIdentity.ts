import { useQuery } from "convex/react";

import { api } from "~/convex/_generated/api";

export function useConvexAuthIdentity() {
  return useQuery(api.app.getCurrentUserIdentity);
}

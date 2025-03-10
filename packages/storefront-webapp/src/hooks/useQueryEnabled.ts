import { ORGANIZATION_ID_KEY, STORE_ID_KEY } from "@/lib/constants";
import { useGetStore } from "./useGetStore";

export const useQueryEnabled = () => {
  const storeId = localStorage.getItem(STORE_ID_KEY);
  const organizationId = localStorage.getItem(ORGANIZATION_ID_KEY);

  const { data: store } = useGetStore({
    enabled: Boolean(!storeId && !organizationId),
    asNewUser: false,
  });

  return (
    Boolean(storeId && organizationId) ||
    Boolean(store?._id && store?.organizationId)
  );
};

import { useGetStore } from "./useGetStore";

export const useQueryEnabled = () => {
  const { data: store } = useGetStore({
    enabled: true,
    asNewUser: false,
  });

  return Boolean(store?._id && store?.organizationId);
};

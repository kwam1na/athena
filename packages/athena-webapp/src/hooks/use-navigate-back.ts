import { useNavigate, useSearch } from "@tanstack/react-router";
import useGetActiveStore from "./useGetActiveStore";
import { useGetActiveOrganization } from "./useGetOrganizations";

export const useNavigateBack = ({
  url,
  params,
}: {
  url?: string;
  params?: any;
} = {}) => {
  const { o } = useSearch({ strict: false });

  const navigate = useNavigate();

  const { activeStore } = useGetActiveStore();

  const { activeOrganization } = useGetActiveOrganization();

  return () => {
    if (o) {
      navigate({ to: decodeURIComponent(o) });
    } else if (url) {
      navigate({
        to: url,
        params: (prev) => ({
          ...prev,
          storeUrlSlug: activeStore?.slug,
          orgUrlSlug: activeOrganization?.slug,
          ...params,
        }),
      });
    }
  };
};

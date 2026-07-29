import { useNavigate, useSearch } from "@tanstack/react-router";
import useGetActiveStore from "./useGetActiveStore";
import { useGetActiveOrganization } from "./useGetOrganizations";

type NavigateBackParams = Record<string, string | undefined>;

export const useNavigateBack = ({
  url,
  params,
}: {
  url?: string;
  params?: NavigateBackParams;
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
        params: (prev: NavigateBackParams) => ({
          ...prev,
          storeUrlSlug: activeStore?.slug,
          orgUrlSlug: activeOrganization?.slug,
          ...params,
        }),
      });
    }
  };
};

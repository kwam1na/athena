import { useEffect } from "react";
import { useGetStores } from "../hooks/useGetActiveStore";
import View from "./View";
import { useNavigate, useParams } from "@tanstack/react-router";
import { usePermissions } from "../hooks/usePermissions";
import { getStoreEntryRouteForRole } from "@/lib/navigation/storeEntryRoute";

export default function OrganizationView() {
  const Navigation = () => {
    return (
      <div className="flex gap-2 h-[40px]">
        <div className="flex items-center"></div>
      </div>
    );
  };

  const navigate = useNavigate();

  const stores = useGetStores();
  const { isLoading, role } = usePermissions();

  const { orgUrlSlug } = useParams({ strict: false });

  useEffect(() => {
    if (!isLoading && stores && stores.length > 0 && orgUrlSlug) {
      const store = stores[0];

      navigate({
        to: getStoreEntryRouteForRole(role),
        params: (prev) => ({
          ...prev,
          orgUrlSlug,
          storeUrlSlug: store.slug,
        }),
      });
    }
  }, [isLoading, stores, orgUrlSlug, navigate, role]);

  return (
    <View header={<Navigation />}>
      <span />
    </View>
  );
}

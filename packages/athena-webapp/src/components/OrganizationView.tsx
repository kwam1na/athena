import { useEffect } from "react";
import { useGetStores } from "../hooks/useGetActiveStore";
import View from "./View";
import { useNavigate, useParams } from "@tanstack/react-router";

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

  const { orgUrlSlug } = useParams({ strict: false });

  useEffect(() => {
    if (stores && stores.length > 0 && orgUrlSlug) {
      const store = stores[0];

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/products",
        params: (prev) => ({
          ...prev,
          orgUrlSlug,
          storeUrlSlug: store.slug,
        }),
      });
    }
  }, [stores, orgUrlSlug]);

  return (
    <View className="bg-background" header={<Navigation />}>
      <span />
    </View>
  );
}

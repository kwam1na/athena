import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import PromoCodes from "./PromoCodes";

export default function PromoCodesView() {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const promoCodes: any[] = [];

  if (!activeStore || !products) return null;

  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
        <div className="flex items-center">
          <p className="text-3xl font-medium">Promo codes</p>
        </div>
      </div>
    );
  };

  const hasCodes = promoCodes.length > 0;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasCodes && <Navigation />}
    >
      <PromoCodes promoCodes={promoCodes} />
    </View>
  );
}

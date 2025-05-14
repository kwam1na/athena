import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import PromoCodes from "./PromoCodes";
import { currencyFormatter } from "~/src/lib/utils";
import { PromoCode } from "~/types";

export default function PromoCodesView() {
  const { activeStore } = useGetActiveStore();

  const promoCodes = useQuery(
    api.inventory.promoCode.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || !promoCodes) return null;

  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
        <div className="flex items-center">
          <p className="text-xl font-medium">Promo codes</p>
        </div>
      </div>
    );
  };

  const formatter = currencyFormatter(activeStore.currency);

  const hasCodes = promoCodes.length > 0;

  const promoCodesFormatted = promoCodes.map((promoCode: PromoCode) => {
    return {
      ...promoCode,
      discountValue:
        promoCode.discountType === "amount"
          ? formatter.format(promoCode.discountValue)
          : `${promoCode.discountValue}%`,
    };
  });

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasCodes && <Navigation />}
    >
      <PromoCodes promoCodes={promoCodesFormatted} />
    </View>
  );
}

import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { GenericDataTable } from "../../base/table/data-table";
import { capturedEmailsColumns } from "./captured-emails-columns";
import { Id } from "~/convex/_generated/dataModel";

interface CapturedEmailsProps {
  promoCodeId?: Id<"promoCode">;
}

export default function CapturedEmails({
  promoCodeId,
}: CapturedEmailsProps = {}) {
  const { activeStore } = useGetActiveStore();

  // If promoCodeId is provided, get offers for that specific promo code
  // Otherwise, get all offers for the store
  const offers = useQuery(
    promoCodeId
      ? api.storeFront.offers.getByPromoCodeId
      : api.storeFront.offers.getAll,
    promoCodeId
      ? { promoCodeId }
      : activeStore?._id
        ? { storeId: activeStore?._id }
        : "skip"
  );

  if (!offers) return null;

  return <GenericDataTable data={offers} columns={capturedEmailsColumns} />;
}

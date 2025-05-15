import { useMutation } from "convex/react";
import { ComposedPageHeader } from "../common/PageHeader";
import { LoadingButton } from "../ui/loading-button";
import { Save, TrashIcon } from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { api } from "~/convex/_generated/api";
import { useState } from "react";
import { Id } from "~/convex/_generated/dataModel";
import { toast } from "sonner";

interface PromoCodeHeaderProps {
  isUpdating: boolean;
  handleSave: () => void;
}

const PromoCodeHeader = ({ isUpdating, handleSave }: PromoCodeHeaderProps) => {
  const navigate = useNavigate();
  const { promoCodeSlug } = useParams({ strict: false });
  const [isDeletingPromoCode, setIsDeletingPromoCode] = useState(false);
  const deletePromoCode = useMutation(api.inventory.promoCode.remove);

  const handleDeletePromoCode = async () => {
    try {
      setIsDeletingPromoCode(true);
      await deletePromoCode({ id: promoCodeSlug as Id<"promoCode"> });
      toast.success("Promo code deleted");
      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/promo-codes",
        params: (prev) => ({
          ...prev,
          storeUrlSlug: prev.storeUrlSlug!,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    } catch (e) {
      toast.error("Failed to delete promo code", {
        description: (e as Error).message,
      });
    } finally {
      setIsDeletingPromoCode(false);
    }
  };

  const header = promoCodeSlug ? "Manage promo code" : "Add promo code";

  return (
    <ComposedPageHeader
      leadingContent={<p className="text-sm">{header}</p>}
      trailingContent={
        <>
          {promoCodeSlug && (
            <div className="ml-auto space-x-2">
              <LoadingButton
                isLoading={isUpdating}
                variant={"outline"}
                onClick={handleSave}
              >
                <Save className="w-4 h-4" />
              </LoadingButton>

              <LoadingButton
                isLoading={isDeletingPromoCode}
                className="text-red-400 hover:bg-red-300 hover:text-red-800"
                variant={"outline"}
                onClick={handleDeletePromoCode}
              >
                <TrashIcon className="w-4 h-4" />
              </LoadingButton>
            </div>
          )}
        </>
      }
    />
  );
};

export default PromoCodeHeader;

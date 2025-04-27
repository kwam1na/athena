import { Product, ProductSku } from "@athena/webapp";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { capitalizeWords, getProductName } from "@/lib/utils";
import { LoadingButton } from "../ui/loading-button";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { useQuery } from "@tanstack/react-query";

export function OnsaleProduct() {
  const promoCodeQueries = usePromoCodesQueries();

  const { data } = useQuery(promoCodeQueries.getAllItems());

  const p = data?.[0];

  if (!p) return null;

  return (
    <div className="w-full">
      <div className="flex h-full w-full gap-4">
        <img
          src={p?.images[0]}
          alt={`Preview`}
          className={`aspect-square w-[116px] h-[116px] object-cover rounded-md`}
        />
        <div className="space-y-2">
          <p className="text-sm">{getProductName(p)}</p>
          <p className="text-sm">
            Included <b>free</b> with your purchase
          </p>
          {/* <LoadingButton
            className="pt-8 px-0"
            variant={"link"}
            isLoading={false}
            onClick={handleAddProduct}
          >
            {"Add to bag"}
          </LoadingButton> */}
        </div>
      </div>
    </div>
  );
}

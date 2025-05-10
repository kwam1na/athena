import { getProductName } from "@/lib/utils";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { useQuery } from "@tanstack/react-query";

export function OnsaleProduct() {
  const promoCodeQueries = usePromoCodesQueries();

  const { data } = useQuery(promoCodeQueries.getAllItems());

  const p = data?.[0];

  if (!p || !p.productSku) return null;

  return (
    <div className="w-full border rounded-md p-4 border-accent2/10 bg-accent2/10">
      <div className="flex h-full w-full gap-4">
        <img
          src={p.productSku.images[0]}
          alt={`Preview`}
          className={`aspect-square w-[116px] h-[116px] object-cover rounded-md`}
        />
        <div className="space-y-4">
          <div className="flex items-center items-start gap-2">
            <p className="text-sm">
              {getProductName(p.productSku)} <b>(GHS 180 value)</b>
            </p>
          </div>
          <p className="text-sm">
            Included with your purchase — while supplies last
          </p>
          <p className="text-sm italic text-muted-foreground">
            <b>{p.quantityClaimed}</b> of <b>{p.quantity}</b> claimed — Few
            remaining
          </p>
        </div>
      </div>
    </div>
  );
}

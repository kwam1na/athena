// import { getProductBySlug } from "@/api/product";
import { useStoreContext } from "@/contexts/StoreContext";
import { ProductResponseBody } from "@/lib/schemas/product";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { LoadingButton } from "../ui/loading-button";
import { useServerFn } from "@tanstack/start";
import { getProductBySlug } from "@/server-actions/products";
import { Product } from "@athena/db";
import { useShoppingBag } from "@/hooks/useShoppingBag";

export default function ProductPage() {
  const { productSlug } = useParams({ strict: false });

  const { formatter } = useStoreContext();

  const { bag, addProductToBag, updateBag, isUpdatingBag } = useShoppingBag();

  const fetchProductBySlug = useServerFn(getProductBySlug);

  const { data: product } = useQuery({
    queryKey: ["product", productSlug],
    queryFn: () => fetchProductBySlug(productSlug!),
    enabled: Boolean(productSlug),
  });

  const bagItem = bag?.items.find((it) => it.id == product?.id);

  const handleUpdateBag = () => {
    if (bagItem && product) {
      updateBag({ itemId: bagItem.id, quantity: bagItem.quantity + 1 });
    } else if (product) {
      addProductToBag({
        price: product.price,
        quantity: 1,
        productId: product.id,
      });
    }
  };

  if (!product) return null;

  return (
    <main className="w-full h-full px-[240px] mt-[80px]">
      <div className="flex gap-12">
        <div className="space-y-4">
          <img
            alt={`$ image`}
            className={`aspect-square w-96 h-96 rounded-md object-cover`}
            src={product.images[0]}
          />

          <div className="flex gap-2">
            {product.images.slice(1).map((url, index) => (
              <img
                key={index}
                alt={`$ image`}
                className={`aspect-square w-16 h-16 rounded-md object-cover cursor-pointer`}
                src={url}
              />
            ))}
          </div>
        </div>

        <div className="space-y-12">
          <div className="space-y-4">
            <p className="text-3xl font-medium">{product.name}</p>
            <p className="text-lg font-medium">
              {formatter.format(product.price)}
            </p>
          </div>

          <LoadingButton
            isLoading={false}
            disabled={isUpdatingBag}
            onClick={handleUpdateBag}
          >
            {/* <ShoppingBasket className="w-4 h-4 mr-2" /> */}
            Add to bag
          </LoadingButton>
        </div>
      </div>
    </main>
  );
}

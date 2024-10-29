import { useStoreContext } from "@/contexts/StoreContext";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { LoadingButton } from "../ui/loading-button";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { getProduct } from "@/api/product";
import { BagItem, Product, ProductSku } from "@athena/webapp-2";
import { Button } from "../ui/button";
import { capitalizeWords } from "@/lib/utils";

function ProductAttribute({
  product,
  selectedSku,
}: {
  product: Product;
  selectedSku: ProductSku;
}) {
  const colors: string[] = Array.from(
    new Set(product.skus.map((sku: ProductSku) => sku.colorName))
  );

  // const lengths: string[] = Array.from(
  //   new Set(product.skus.map((sku: ProductSku) => sku.length))
  // );

  const lengths: number[] = Array.from(
    new Set(
      product.skus
        .filter((sk: ProductSku) => sk.colorName == selectedSku.colorName)
        .map((sku: ProductSku) => sku.length)
        .sort()
    )
  );

  const navigate = useNavigate();

  const handleClick = (attribute: "color" | "length", value: string) => {
    let variant;

    if (attribute == "color") {
      variant =
        product.skus.find(
          (sk: ProductSku) =>
            sk.colorName == value && sk.length == selectedSku.length
        ) || product.skus.find((sk: ProductSku) => sk.colorName == value);
    } else {
      variant =
        product.skus.find(
          (sk: ProductSku) =>
            sk.length == value && sk.colorName == selectedSku.colorName
        ) || product.skus.find((sk: ProductSku) => sk.length == value);
    }

    navigate({
      to: "/shop/product/$productSlug",
      params: (prev) => ({ productSlug: prev.productSlug! }),
      search: {
        variant: variant.sku,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <p className="text-muted-foreground">Color</p>

        <div className="flex gap-2">
          {colors.map((color, index) => {
            return (
              <Button
                variant={"ghost"}
                key={index}
                className={`${selectedSku?.colorName == color ? "border border-2 border-black" : "border border-2 border-background-muted"}`}
                onClick={() => handleClick("color", color)}
              >
                {capitalizeWords(color)}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-muted-foreground">Length</p>

        <div className="flex gap-2">
          {lengths.map((length, index) => {
            return (
              <Button
                variant={"ghost"}
                key={index}
                className={`${selectedSku?.length == length ? "border border-2 border-black" : "border border-2 border-background-muted"}`}
                onClick={() => handleClick("length", length.toString())}
              >
                {`${length}''`}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ProductPage() {
  const { productSlug } = useParams({ strict: false });

  const { formatter, store } = useStoreContext();

  const { bag, addProductToBag, updateBag, isUpdatingBag } = useShoppingBag();

  const { data: product } = useQuery({
    queryKey: ["product", productSlug],
    queryFn: () =>
      getProduct({
        organizationId: store!.organizationId,
        storeId: store!._id,
        productId: productSlug!,
      }),
    enabled: Boolean(productSlug && store),
  });

  const getProductName = (item: ProductSku) => {
    if (item.productCategory == "Wigs") {
      return `${item.length}'' ${capitalizeWords(item.colorName)} ${item.productName}`;
    }

    return item.productName;
  };

  const handleUpdateBag = () => {
    if (bagItem && productSku) {
      updateBag({ itemId: bagItem._id, quantity: bagItem.quantity + 1 });
    } else if (productSku) {
      addProductToBag({
        quantity: 1,
        productId: product._id,
        productSkuId: productSku._id,
        productSku: productSku.sku,
      });
    }
  };

  const { variant } = useSearch({ strict: false });

  const selectedSku = product?.skus.find((sk: ProductSku) => sk.sku == variant);

  if (!product) return null;

  let productSku: ProductSku = product.skus[0];

  if (selectedSku) productSku = selectedSku;

  const bagItem = bag?.items?.find(
    (it: BagItem) => it.productSku == productSku.sku
  );

  return (
    <main className="w-full h-full px-[240px] mt-[80px]">
      <div className="flex gap-12">
        <div className="space-y-4 w-[50%]">
          <img
            alt={`${productSku.productName} image`}
            className={`aspect-square rounded-md object-cover`}
            src={productSku.images[0]}
          />

          <div className="flex gap-2">
            {productSku.images.slice(1).map((url: string, index: number) => (
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
            <p className="text-3xl font-medium">{getProductName(productSku)}</p>
            <p className="text-lg font-medium">
              {formatter.format(productSku.price)}
            </p>
          </div>

          <ProductAttribute product={product} selectedSku={productSku} />

          <LoadingButton
            isLoading={isUpdatingBag}
            disabled={isUpdatingBag}
            onClick={handleUpdateBag}
          >
            {/* <ShoppingBasket className="w-4 h-4 mr-2" /> */}
            ADD TO BAG
          </LoadingButton>
        </div>
      </div>
    </main>
  );
}

import { Product, ProductSku } from "@athena/webapp-2";

export function ProductCard({
  product,
  currencyFormatter,
}: {
  product: Product;
  currencyFormatter: Intl.NumberFormat;
}) {
  if (!product) return null;
  return (
    <div className="flex flex-col">
      <div className="mb-2 overflow-hidden">
        <img
          alt={`${product?.name} image`}
          className="aspect-square object-cover rounded"
          src={product?.skus?.[0].images[0]}
        />
      </div>
      <div className="text-sm flex flex-col items-start gap-4">
        <p className="font-medium">{product?.name}</p>
        <p className="text-xs">
          {currencyFormatter.format(product?.skus?.[0].price)}
        </p>
      </div>
    </div>
  );
}

export function ProductSkuCard({
  product,
  sku,
  currencyFormatter,
}: {
  product: Product;
  sku: ProductSku;
  currencyFormatter: Intl.NumberFormat;
}) {
  if (!product) return null;
  return (
    <div className="flex flex-col">
      <div className="mb-2 overflow-hidden">
        <img
          alt={`${product?.name} image`}
          className="aspect-square object-cover rounded"
          src={sku.images[0]}
        />
      </div>
      <div className="text-sm flex flex-col items-start gap-4">
        <p className="font-medium">{product?.name}</p>
        <p className="text-xs">{currencyFormatter.format(sku.price)}</p>
      </div>
    </div>
  );
}

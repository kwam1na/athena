import { Product, ProductSku } from "@athena/webapp";

export function ProductCard({
  product,
  currencyFormatter,
}: {
  product: Product;
  currencyFormatter: Intl.NumberFormat;
}) {
  if (!product) return null;

  const uniqueColors = Array.from(
    new Set(product.skus.map((sku) => sku.color))
  ).length;

  return (
    <div className="flex flex-col space-y-4">
      <div className="overflow-hidden">
        <img
          alt={`${product?.name} image`}
          className="aspect-square object-cover rounded"
          src={product?.skus?.[0].images[0]}
        />
      </div>
      <div className="flex flex-col items-start space-y-2">
        <p className="font-medium">{product?.name}</p>
        <div className="flex gap-2">
          <p className="text-sm">
            {currencyFormatter.format(product?.skus?.[0].price)}
          </p>
          {uniqueColors > 1 && (
            <p className="text-sm text-gray-600">{uniqueColors} colors</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProductSkuCard({
  sku,
  currencyFormatter,
}: {
  sku: ProductSku;
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-2 overflow-hidden">
        <img
          alt={`${sku?.productName} image`}
          className="aspect-square object-cover rounded"
          src={sku.images[0]}
        />
      </div>
      <div className="text-sm flex flex-col items-start gap-4">
        <p className="font-medium">{sku?.productName}</p>
        <p className="text-xs">{currencyFormatter.format(sku.price)}</p>
      </div>
    </div>
  );
}

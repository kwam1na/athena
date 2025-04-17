import { capitalizeWords } from "@/lib/utils";
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

  const isSoldOut = product.skus.every(
    (sku) => sku.quantityAvailable === 0 && sku.inventoryCount === 0
  );

  const isSellingFast = product.skus.some(
    (sku) => sku.quantityAvailable > 0 && sku.quantityAvailable <= 2
  );

  return (
    <div className="flex flex-col space-y-4">
      <div className="overflow-hidden relative">
        <img
          alt={`${product?.name} image`}
          className="aspect-square md:aspect-auto md:w-[300px] md:h-[400px] object-cover rounded"
          src={product?.skus?.[0].images[0]}
        />
        {isSoldOut && (
          <div className="font-medium text-xs absolute top-0 left-0 m-2 text-white bg-black bg-opacity-40 rounded-md px-2 py-1">
            Sold Out
          </div>
        )}

        {!isSoldOut && isSellingFast && (
          <div className="font-medium text-xs absolute top-0 left-0 m-2 text-white bg-black bg-opacity-40 rounded-md px-2 py-1">
            🔥 Selling fast
          </div>
        )}
      </div>
      <div className="flex flex-col items-start space-y-2">
        <p className="font-medium">{capitalizeWords(product?.name)}</p>
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
  const isSoldOut = sku.quantityAvailable === 0 && sku.inventoryCount === 0;

  return (
    <div className="flex flex-col">
      <div className="mb-2 overflow-hidden relative">
        <img
          alt={`${sku?.productName} image`}
          className="aspect-square md:aspect-auto md:w-[300px] md:h-[400px] object-cover rounded"
          src={sku.images[0]}
        />

        {isSoldOut && (
          <div className="font-medium text-xs absolute top-0 left-0 m-2 text-white bg-black bg-opacity-40 rounded-md px-2 py-1">
            Sold Out
          </div>
        )}
      </div>
      <div className="text-sm flex flex-col items-start gap-4">
        <p className="font-medium">
          {sku?.productName && capitalizeWords(sku?.productName)}
        </p>
        <p className="text-xs">{currencyFormatter.format(sku.price)}</p>
      </div>
    </div>
  );
}

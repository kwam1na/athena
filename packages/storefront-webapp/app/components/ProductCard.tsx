import { Product } from "@athena/webapp-2";

export function ProductCard({
  product,
  currencyFormatter,
}: {
  product: Product;
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-2 overflow-hidden">
        <img
          alt={`${product.name} image`}
          className="aspect-square object-cover rounded"
          src={product.skus[0].images[0]}
        />
      </div>
      <div className="text-sm flex flex-col items-start gap-4">
        <p className="font-medium">{product.name}</p>
        <p className="text-xs">
          {currencyFormatter.format(product.skus[0].price)}
        </p>
      </div>
    </div>
  );
}

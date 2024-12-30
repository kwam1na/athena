import { Product } from "@athena/webapp-2";

export function ProductCard({
  product,
  currencyFormatter,
}: {
  product: Product;
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <div className="flex flex-col mb-24">
      <div className="mb-2">
        <img
          alt={`${product.name} image`}
          className="aspect-square object-cover"
          src={product.skus[0].images[0]}
        />
      </div>
      <div className="text-sm flex flex-col px-4 lg:px-0 items-start gap-4">
        <p className="font-medium">{product.name}</p>
        <p className="text-xs">
          {currencyFormatter.format(product.skus[0].price)}
        </p>
      </div>
    </div>
  );
}

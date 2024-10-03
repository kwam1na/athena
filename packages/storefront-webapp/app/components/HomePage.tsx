import { useQuery } from "@tanstack/react-query";
import { getAllProducts } from "@/api/product";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { Link } from "@tanstack/react-router";
import { useStoreContext } from "@/contexts/StoreContext";
import { Product } from "@athena/db";

export default function HomePage() {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["products"],
    queryFn: () =>
      getAllProducts({
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
  });

  return data ? <ProductsPage products={data} /> : null;
}

// function ProductCard({
//   product,
//   currencyFormatter,
// }: {
//   product: Product;
//   currencyFormatter: Intl.NumberFormat;
// }) {
//   return (
//     <div className="m-8 space-y-16 flex flex-col justify-center border items-center">
//       <img
//         alt={`${product.name} image`}
//         className={`aspect-square w-64 h-64 rounded-md object-cover`}
//         src={product.images[0]}
//       />

//       <div className="">
//         <p className="text-lg font-medium">{product.name}</p>
//         <p className="text-muted-foreground">
//           {currencyFormatter.format(product.price)}
//         </p>
//       </div>
//     </div>
//   );
// }

function ProductCard({
  product,
  currencyFormatter,
}: {
  product: Product;
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <div className="flex flex-col mb-24">
      <div className="aspect-square w-full mb-2">
        <img
          alt={`${product.name} image`}
          className="w-full h-full object-cover"
          src={product.images[0]}
        />
      </div>
      <div className="flex flex-col items-start gap-2">
        <p className="text-lg font-medium">{product.name}</p>
        <p className="text-gray-500">
          {currencyFormatter.format(product.price)}
        </p>
      </div>
    </div>
  );
}

// function ProductsPage({ products }: { products: Product[] }) {
//   // replace with empty state
//   if (products.length == 0) return null;

//   const { formatter } = useStoreContext();

//   return (
//     <main className="grid grid-cols-3 gap-12">
//       {products?.map((product) => {
//         return (
//           <Link
//             to="/shop/product/$productSlug"
//             key={product.id}
//             params={(params) => ({
//               ...params,
//               productSlug: product.slug,
//             })}
//           >
//             <ProductCard
//               key={product.id}
//               product={product}
//               currencyFormatter={formatter}
//             />
//           </Link>
//         );
//       })}
//     </main>
//   );
// }

function ProductsPage({ products }: { products: Product[] }) {
  if (products.length === 0) return null;

  const { formatter } = useStoreContext();

  return (
    <main className="px-4 py-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {products?.map((product) => (
          <Link
            to="/shop/product/$productSlug"
            key={product.id}
            params={(params) => ({
              ...params,
              productSlug: product.slug,
            })}
            className="block"
          >
            <ProductCard
              key={product.id}
              product={product}
              currencyFormatter={formatter}
            />
          </Link>
        ))}
      </div>
    </main>
  );
}

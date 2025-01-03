import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
} from "@/components/ui/breadcrumb";
import { useGetProductQuery } from "@/hooks/useGetProduct";
import { capitalizeWords, slugToWords } from "@/lib/utils";
import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export function ProductNavigationBar() {
  const { productSlug } = useParams({ strict: false });
  const { data: product } = useGetProductQuery(productSlug);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    ref.current?.scrollIntoView();
  }, []);

  if (!product) return null;

  return (
    <Breadcrumb
      className="container mx-auto px-6 xl:px-0 py-2 lg:py-8"
      ref={ref}
    >
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink>
            <Link to="/">
              <p className="text-xs">Shop</p>
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <p>/</p>
        {product?.categoryName && (
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link
                to="/shop/$categorySlug"
                params={{
                  categorySlug: product?.categorySlug,
                }}
              >
                <p className="text-xs">
                  {capitalizeWords(slugToWords(product.categoryName))}
                </p>
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
        )}
        {product?.subcategoryName && (
          <>
            <p>/</p>
            <BreadcrumbItem>
              <Link></Link>
              <BreadcrumbLink asChild>
                <Link
                  to="/shop/$categorySlug/$subcategorySlug"
                  params={{
                    subcategorySlug: product?.subcategorySlug,
                    categorySlug: product?.categorySlug,
                  }}
                >
                  <p className="text-xs">
                    {capitalizeWords(slugToWords(product.subcategoryName))}
                  </p>
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

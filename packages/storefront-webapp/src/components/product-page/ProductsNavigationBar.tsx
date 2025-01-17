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
          <Link to="/">
            <p className="text-xs">Shop</p>
          </Link>
        </BreadcrumbItem>
        <p>/</p>
        {(product as any)?.categoryName && (
          <BreadcrumbItem>
            <Link
              to="/shop/$categorySlug"
              params={{
                categorySlug: (product as any)?.categorySlug,
              }}
            >
              <p className="text-xs">
                {capitalizeWords(slugToWords((product as any).categoryName))}
              </p>
            </Link>
          </BreadcrumbItem>
        )}
        {(product as any)?.subcategoryName && (
          <>
            <p>/</p>
            <BreadcrumbItem>
              <Link
                to="/shop/$categorySlug/$subcategorySlug"
                params={{
                  subcategorySlug: (product as any)?.subcategorySlug,
                  categorySlug: (product as any)?.categorySlug,
                }}
              >
                <p className="text-xs">
                  {capitalizeWords(
                    slugToWords((product as any).subcategoryName)
                  )}
                </p>
              </Link>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

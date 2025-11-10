import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useGetProductsWithNoImages } from "./useGetProducts";
import { AlertOctagon } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const useProductWithNoImagesNotification = () => {
  const productsWithNoImages = useGetProductsWithNoImages();
  const toastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (productsWithNoImages && productsWithNoImages.length > 0) {
      if (!toastIdRef.current) {
        toastIdRef.current = toast("Some products require your attention", {
          icon: <AlertOctagon className="w-4 h-4 text-[#1e3a8a]" />,
          duration: Infinity,
          className: "border border-blue-200 bg-[#e0edff] text-[#1e3a8a]",
          description: (
            <Link
              className="text-blue-600 hover:text-blue-800 hover:underline"
              to="/$orgUrlSlug/store/$storeUrlSlug/products/unresolved"
              params={(params) => ({
                ...params,
                orgUrlSlug: params.orgUrlSlug!,
                storeUrlSlug: params.storeUrlSlug!,
              })}
            >
              View products
            </Link>
          ),
        });
      }
    } else if (toastIdRef.current) {
      toast.dismiss(toastIdRef.current);
      toastIdRef.current = null;
    }
  }, [productsWithNoImages]);
};

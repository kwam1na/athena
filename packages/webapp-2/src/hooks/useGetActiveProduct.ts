import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { getProduct } from "@/api/product";
import useGetActiveStore from "./useGetActiveStore";

export default function useGetActiveProduct() {
  const { productSlug } = useParams({ strict: false });

  const { activeStore } = useGetActiveStore();

  const {
    data: product,
    isLoading: isLoadingStores,
    isFetching,
  } = useQuery({
    queryKey: ["product", productSlug],
    queryFn: () =>
      getProduct({
        organizationId: activeStore!.organizationId,
        storeId: activeStore!.id,
        productId: productSlug!,
      }),
    enabled: Boolean(productSlug && activeStore),
  });

  return {
    activeProduct: product,
    isLoadingStores: isLoadingStores || isFetching,
  };
}

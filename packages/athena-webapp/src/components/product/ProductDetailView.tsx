import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import View from "../View";
import { Button } from "../ui/button";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Badge } from "../ui/badge";
import { SKUSelector } from "./SKUSelector";
import { ProductProvider, useProduct } from "~/src/contexts/ProductContext";
import { DetailsView } from "./DetailsView";
import { AttributesView } from "./AttributesView";
import { CategorizationView } from "./CategorizationView";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import { ImagesView } from "./ImagesView";
import { PenIcon } from "lucide-react";

const ProductDetailViewHeader = () => {
  const { o } = useSearch({ strict: false });

  const navigate = useNavigate();

  const { activeProduct } = useGetActiveProduct();

  const { activeProductVariant } = useProduct();

  const handleBackClick = () => {
    if (o) {
      navigate({ to: decodeURIComponent(o) });
    } else {
      window.history.back();
    }
  };

  if (!activeProduct) return null;

  return (
    <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleBackClick}
            variant="ghost"
            className="h-8 px-2 lg:px-3 "
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-sm">{activeProduct?.name}</p>

        <Badge
          className="rounded-lg text-xs text-muted-foreground"
          variant={"outline"}
        >
          <p>{activeProduct?.availability.toUpperCase()}</p>
        </Badge>
      </div>

      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          productSlug: activeProduct.slug,
        })}
        search={{
          o: encodeURIComponent(
            `${window.location.pathname}${window.location.search}`
          ),
          variant: activeProductVariant?.sku,
        }}
      >
        <Button variant="outline">
          <PenIcon className="h-3.5 w-3.5 mr-2" />
          Edit
        </Button>
      </Link>
    </div>
  );
};

export const ProductDetailView = () => {
  return (
    <ProductProvider>
      <View
        hideBorder
        hideHeaderBottomBorder
        header={<ProductDetailViewHeader />}
      >
        <div className="container mx-auto h-full w-full p-8 space-y-12">
          <div className="grid grid-cols-2">
            <div className="space-y-8">
              <SKUSelector />

              <DetailsView />

              <AttributesView />

              <CategorizationView />
            </div>

            <ImagesView />
          </div>
        </div>
      </View>
    </ProductProvider>
  );
};